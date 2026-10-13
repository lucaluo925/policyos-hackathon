/**
 * The verification pipeline, as an async generator of progress events.
 *
 * Why a generator rather than a function returning a result: the same code
 * path has to serve two very different consumers — an SSE route handler that
 * streams stages to a browser, and a headless smoke script that prints them.
 * Yielding events keeps one implementation and makes the UI's progress display
 * a view of what actually happened rather than a decorative animation.
 *
 * This module does not write to the database or change country scores.
 * The live API stores completed output through review-sink.ts as low-confidence
 * `ai_inferred` claim_verification review material. Existing target/confidence
 * gates bar it from score mutations. The conflict flag here describes screened
 * source directions; it does not establish policy approval or quarantine.
 */

import {
  MODEL_ADJUDICATOR,
  MODEL_SCREENER,
  MODEL_DECOMPOSER,
  callTool,
  isNemotronConfigured,
} from './nemotron';
import { TavilyClient, isTavilyConfigured } from './tavily';
import { boeDocumentId, readBoeMetadata } from './boe-metadata';
import { hasClaimDateRelation, inspectSourceExcerpts, readIssuerHtml,
  sourceInspectionUrls } from './source-inspection';
import { needsOfficialSearch, officialSearchDomains, officialSearchQuery,
  isInSearchScope, scopedHitAddsSection, scopedHitAddsYear, scopedHitAddsBoundary,
  lacksExceptionDisposition, scopedHitAddsDisposition, scopedHitAddsRoute,
  scopedHitAddsGroup, officialSearchCollections } from './official-search';
import { preserveTopicalOfficialSource, screeningJudgements } from './screening';
import { reusableIssuerEvidence } from './evidence-reuse';
import { qualifierSearchQuery, scopedHitAddsQualifier } from './qualifiers';
import { isSourceNavigation, currentInstructionTitle } from './source-navigation';
import { discoverCurrentManual } from './manual-discovery';
import { isOfficialSource } from './sources';
import { preserveClaimYears, preserveDatedContractEligibility, preserveIndependentReferents,
  preserveScopeDateRelation } from './decomposition';
import {
  ADJUDICATION_EXCERPT_LIMIT,
  OFFICIAL_ADJUDICATION_EXCERPT_LIMIT,
  VERDICTS,
  type Assertion,
  type AssertionResult,
  type EvidenceDoc,
  type ScreenedDoc,
  type Verdict,
  type OverallVerdict,
  type VerifyEvent,
  type VerificationResult,
  type SourceInspectionRecord,
} from './types';

export interface PipelineOptions {
  /** Abort upstream calls when the stream disconnects or the run deadline expires. */
  signal?: AbortSignal;
  /** Scoped headless transport; propagated to every provider call. */
  fetch?: typeof fetch;
  /**
   * Override the decomposition model. Exists so the two candidates can be
   * compared over the same claims through the real pipeline rather than a
   * reimplementation of it — a comparison run on a copy of the code measures
   * the copy.
   */
  decomposeModel?: string;
  /** Bounded first-stage timeout; injectable for deterministic timeout tests. */
  decomposeTimeoutMs?: number;
  /** Hard cap on Tavily calls for this run. Pay-as-you-go is on; a loop costs money. */
  tavilyBudget?: number;
  /** Assertions to keep after decomposition. Bounds total cost per run. */
  maxAssertions?: number;
  /** Documents retrieved per assertion. */
  resultsPerAssertion?: number;
  /** Opt-in official-domain discovery and source passages; Search-only remains the API default. */
  inspectSources?: boolean;
}

/**
 * Rolls per-assertion verdicts up to one answer for the claim.
 *
 * The claim is treated as the CONJUNCTION of its assertions:
 *
 *   refuted    any assertion is refuted. A false conjunct makes the
 *              conjunction false no matter how many others are unknown, so
 *              `refuted` outranks `insufficient_evidence`. The original order
 *              had this backwards and reported "not enough evidence" for
 *              claims we had positively disproved. Measured on the recorded
 *              2026-10-08 seed runs, correcting it moved 5 verdicts, every one
 *              of them to a claim that is in fact false.
 *
 *   supported  every assertion is supported.
 *
 *   otherwise  insufficient_evidence.
 *
 * ON THE REMOVED `partially_supported`
 *
 * A fourth value for "some supported, none refuted, rest unresolved" was added
 * and then removed the same day. It is recorded here because the reasoning
 * that produced it is tempting and will come back.
 *
 * The argument for it: with three assertions, one unverifiable detail erased
 * everything the evidence did establish, and the Ultra decomposer returned
 * `supported` for 0 of 10 claims.
 *
 * Why it was wrong: decompose does not split a claim into three equal parts.
 * It splits it into presuppositions plus the one assertion that carries the
 * claim's actual content. "Canada operates an Express Entry system" is true of
 * every claim about Express Entry, true or false. The decisive assertion — "In
 * 1992, Canada's CRS cutoff was above 500" — comes back as
 * insufficient_evidence, because nothing on the web asserts the negative of a
 * false specific. So the rule fired precisely on false claims: of eight claims
 * constructed to be false, three were reported as partly supported, including
 * "The United Kingdom left the European Union in 1994".
 *
 * The honest version of this needs a notion of WHICH assertion is decisive,
 * which the pipeline does not currently have. Until it does, a claim whose
 * decisive part is unproven is `insufficient_evidence`, which is the truth.
 *
 * See the hackathon STATUS.md, 2026-10-08 probe, and
 * scripts/probe-decompose-faithfulness.ts.
 */
export function rollUpVerdict(results: readonly AssertionResult[]): OverallVerdict {
  if (results.length === 0) return 'insufficient_evidence';
  if (results.some((r) => r.verdict === 'refuted')) return 'refuted';
  if (results.every((r) => r.verdict === 'supported')) return 'supported';
  return 'insufficient_evidence';
}

const DEFAULTS: Required<Omit<PipelineOptions, 'signal' | 'fetch'>> = {
  decomposeModel: MODEL_DECOMPOSER,
  decomposeTimeoutMs: 15_000,
  tavilyBudget: 6,
  maxAssertions: 3,
  resultsPerAssertion: 5,
  inspectSources: false,
};

/**
 * Below this top relevance score, a retrieval is treated as having returned
 * nothing usable rather than as weak evidence.
 *
 * Observed 2026-10-08: for one identical query, Tavily returned top scores of
 * 0.81, 0.92 and then 0.09 within minutes, the last being generic pages
 * ("List of states and territories of the United States") for a question about
 * export controls. Twelve repeats later the same day were all 0.89-0.93. The
 * cause is unknown and it did not reproduce on demand, so this floor is not a
 * fix for Tavily — it is a guard so that a bad draw is reported as a bad draw.
 *
 * The number matters less than the distinction: good draws here sit at
 * 0.8-0.95 and the bad one at 0.03-0.09, two clear clusters an order of
 * magnitude apart, so any floor between them behaves the same.
 */
const RETRIEVAL_SCORE_FLOOR = 0.3;

/** Returns the reasons this pipeline cannot run, empty when it can. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!isNemotronConfigured()) missing.push('NEBIUS_API_KEY');
  if (!isTavilyConfigured()) missing.push('TAVILY_API_KEY');
  return missing;
}

// ─── Tool schemas ──────────────────────────────────────────────────────────

const DECOMPOSE_TOOL = {
  name: 'record_assertions',
  description:
    'Record the atomic, independently checkable assertions contained in a claim.',
  parameters: {
    type: 'object',
    properties: {
      assertions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            // Deliberately only two fields. An earlier version also asked for
            // country/domain/date/quantity; nothing ever read them, and on Nano
            // they nearly doubled the completion (1114 -> 602 tokens, 14.6s ->
            // 8.4s). Fields a schema asks for are paid for in generation time
            // whether or not the caller uses them.
            text: { type: 'string', description: 'One checkable assertion.' },
            search_query: {
              type: 'string',
              description: 'A web search query that would find evidence for it.',
            },
          },
          required: ['text', 'search_query'],
          additionalProperties: false,
        },
      },
    },
    required: ['assertions'],
    additionalProperties: false,
  },
};

/**
 * Screening exists to throw out documents that are about something else
 * entirely — a recipe, a sports recap. It does NOT exist to decide whether the
 * assertion is true; that is the adjudicator's job, and it needs the evidence
 * in order to do it.
 *
 * Observed 2026-10-08, before this wording existed: for the assertion "in 2026
 * BIS added new Chinese semiconductor firms to the Entity List", the screener
 * discarded all five retrieved documents — including one titled "BIS Adds 36
 * Chinese Companies to Entity List" and a Federal Register page "Additions and
 * Revisions to the Entity List". Nothing reached the adjudicator, and the
 * system reported "insufficient evidence" while holding a document whose title
 * answered the question. The screener had quietly reinterpreted "relevant" as
 * "confirms this exact claim, this exact year".
 */
const SCREEN_TOOL = {
  name: 'record_screening',
  description:
    'Record whether each document is ABOUT THE SAME SUBJECT as the assertion. ' +
    'Relevant means topically related, not that it confirms the assertion. A ' +
    'document that contradicts the assertion, covers a different year, or gives ' +
    'only background on the same subject is RELEVANT. Mark irrelevant only when ' +
    'the document is about an unrelated subject.',
  parameters: {
    type: 'object',
    properties: {
      judgements: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: '0-based index of the document.' },
            relevant: { type: 'boolean' },
            leaning: { type: 'string', enum: ['supports', 'refutes', 'unclear'] },
            reason: { type: 'string' },
          },
          required: ['index', 'relevant', 'leaning'],
          additionalProperties: false,
        },
      },
    },
    required: ['judgements'],
    additionalProperties: false,
  },
};

const ADJUDICATE_TOOL = {
  name: 'record_verdict',
  description:
    'Record the verdict for one assertion, citing only the given documents.',
  parameters: {
    type: 'object',
    properties: {
      verdict: { type: 'string', enum: [...VERDICTS] },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
        // Without this, "insufficient_evidence at 0.7" is unreadable: 70% of
        // what? Pinning it to the verdict makes it mean "70% sure the evidence
        // genuinely does not settle this", which is a statement a reader can
        // act on, and which the downstream resolver can threshold.
        description:
          'Confidence that THIS VERDICT is correct, 0-1. For insufficient_evidence, ' +
          'this is how sure you are that the evidence genuinely fails to settle the ' +
          'question — not how likely the claim is to be true.',
      },
      cited_urls: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
    },
    required: ['verdict', 'confidence', 'cited_urls', 'rationale'],
    additionalProperties: false,
  },
};

const ADJUDICATOR_SYSTEM = [
  'You verify claims about government policy against retrieved documents.',
  'Rules you must follow:',
  '1. Cite only URLs from the documents given to you. Never invent a source.',
  '2. If the documents do not settle the question, answer insufficient_evidence.',
  '   That is a correct answer, not a failure.',
  '3. Absence of evidence is not evidence of absence: not finding a policy does',
  '   not mean it was repealed.',
  '4. Policy is time-sensitive. A document describing an older state of the world',
  '   does not refute a claim about today unless it says so.',
  '5. A supported or refuted verdict must cite at least one given document.',
  '   If you cannot cite evidence for the verdict, answer insufficient_evidence.',
  '6. When a directly relevant issuing-body passage is given, cite that passage',
  '   and explain how it bears on the assertion. An unrelated government page',
  '   or a passage that omits the decisive date, threshold or exception is not proof.',
].join('\n');

// ─── Pipeline ──────────────────────────────────────────────────────────────

export async function* runVerification(
  claim: string,
  options: PipelineOptions = {},
): AsyncGenerator<VerifyEvent, void, void> {
  const opts = { ...DEFAULTS, ...options };
  opts.signal?.throwIfAborted();
  const started = Date.now();
  const missing = missingConfig();
  if (missing.length) {
    yield { type: 'error', stage: 'decompose', message: `missing config: ${missing.join(', ')}` };
    return;
  }

  const tavily = new TavilyClient(opts.tavilyBudget);
  const requestIds: string[] = [];
  const searches: NonNullable<NonNullable<VerificationResult['provenance']>['searches']> = [];
  const adjudicationEvidence: Record<string, EvidenceDoc[]> = {};
  const sourceInspection: Record<string, SourceInspectionRecord> = {};
  const issuerHtmlReads: NonNullable<NonNullable<VerificationResult['provenance']>['issuerHtmlReads']> = {};
  const modelCallRecords: NonNullable<NonNullable<VerificationResult['provenance']>['modelCalls']> = [];
  let modelCalls = 0;
  let retrieved = 0;
  let screenedRelevant = 0;
  let adjudicated = 0;

  // 1. Decompose ───────────────────────────────────────────────────────────
  yield { type: 'stage', stage: 'decompose', status: 'start' };
  let assertions: Array<Assertion & { searchQuery: string }>;
  let decomposerUsed = opts.decomposeModel;
  let wholeClaimFallback = false;
  try {
    const decompose = (model: string) => callTool<{
      assertions: Array<{ text: string; search_query: string }>;
    }>({
      model,
      user:
        `Break this claim into its atomic, independently checkable assertions ` +
        `(at most ${opts.maxAssertions}). For each, give a web search query that ` +
        `would find evidence either way. Keep each date, threshold, exception, ` +
        `and scoped group attached to the proposition it qualifies. A group ` +
        `and its effective date must not become separate assertions if their ` +
        `relationship is what the claim asserts. If necessary, keep the whole ` +
        `relationship as one assertion.\n\nClaim: ${claim}`,
      tool: DECOMPOSE_TOOL,
      // Measured: the decompose output needs ~1400 completion tokens on the
      // most verbose tier. 1024 returned finish_reason=length and no tool call.
      maxTokens: 3072,
      timeoutMs: opts.decomposeTimeoutMs,
      onDiagnostic: record => modelCallRecords.push({ ...record, stage: 'decompose' }),
      signal: opts.signal,
      fetch: opts.fetch,
    });
    let out: Awaited<ReturnType<typeof decompose>> | undefined;
    try {
      modelCalls += 1;
      out = await decompose(opts.decomposeModel);
    } catch (error) {
      const failed = modelCallRecords.at(-1);
      // A transient transport hang can consume the whole live demo without a
      // verdict. Retry exactly once, only before search or adjudication costs
      // begin. Switch the default Super decomposition to Ultra, which passed
      // a forced-tool live check. Keep explicit model overrides on their
      // selected model so comparative probes do not silently switch
      // candidates. Both attempts remain in diagnostics.
      if (opts.signal?.aborted || failed?.stage !== 'decompose' ||
          (failed.failureKind !== 'timeout' && failed.failureKind !== 'network_error')) throw error;
      const retryModel = options.decomposeModel === undefined
        ? MODEL_ADJUDICATOR : opts.decomposeModel;
      const diagnosticsBeforeRetry = modelCallRecords.length;
      modelCalls += 1;
      try {
        out = await decompose(retryModel);
        decomposerUsed = retryModel;
      } catch (retryError) {
        const retryFailure = modelCallRecords.at(-1);
        // A second transport failure may still be temporary. For the normal
        // visitor flow, retain the entire original claim as one assertion so
        // retrieval and adjudication can continue if those calls recover.
        // Explicit model comparisons must fail instead of changing methods.
        if (options.decomposeModel !== undefined || opts.signal?.aborted ||
            modelCallRecords.length !== diagnosticsBeforeRetry + 1 ||
            retryFailure?.stage !== 'decompose' ||
            (retryFailure.failureKind !== 'timeout' && retryFailure.failureKind !== 'network_error')) {
          throw retryError;
        }
        wholeClaimFallback = true;
        decomposerUsed = 'None (original claim used after model transport failures)';
      }
    }
    if (wholeClaimFallback) {
      assertions = [{ id: 'a1', text: claim, searchQuery: claim }];
    } else {
      if (!out || !Array.isArray(out.args.assertions) || out.args.assertions.some(a =>
        !a || typeof a.text !== 'string' || !a.text.trim() ||
        typeof a.search_query !== 'string' || !a.search_query.trim())) {
        throw new Error('decomposition returned malformed assertions');
      }
      assertions = preserveDatedContractEligibility(claim, preserveIndependentReferents(claim,
        preserveClaimYears(claim, preserveScopeDateRelation(claim, out.args.assertions
        .slice(0, opts.maxAssertions)
        .map((a, i) => ({ id: `a${i + 1}`, text: a.text, searchQuery: a.search_query }))))));
    }
  } catch (e) {
    opts.signal?.throwIfAborted();
    yield { type: 'error', stage: 'decompose', message: (e as Error).message };
    yield { type: 'stage', stage: 'decompose', status: 'done', detail: 'failed' };
    return;
  }
  if (!assertions.length) {
    yield { type: 'error', stage: 'decompose', message: 'no checkable assertion found in claim' };
    yield { type: 'stage', stage: 'decompose', status: 'done', detail: 'failed' };
    return;
  }
  yield { type: 'assertions', assertions };
  yield { type: 'stage', stage: 'decompose', status: 'done', detail: wholeClaimFallback
    ? 'model transport failed twice; checking the original claim as one assertion'
    : `${assertions.length} assertion(s)` };

  const results: AssertionResult[] = [];
  // A screened official passage from either an open or scoped Search can
  // settle another assertion in the same claim. Keep its original request
  // IDs and screen it again against the later assertion before adjudication.
  const issuerDomains = opts.inspectSources ? officialSearchDomains(claim) : [];
  const officialEvidenceCache: EvidenceDoc[] = [];
  const boeMetadataCache = new Map<string, EvidenceDoc | null>();

  // Assertions are processed sequentially, not with Promise.all, on purpose:
  //   - work is bounded by the assertion limit and a shared Tavily budget;
  //     the client reserves each call synchronously before awaiting it;
  //   - this is a generator feeding a live progress view, and interleaved
  //     events from parallel assertions would be unreadable.
  // Latency cost is bounded by maxAssertions (default 3).
  for (const [assertionIndex, assertion] of assertions.entries()) {
    opts.signal?.throwIfAborted();
    // 2. Retrieve ──────────────────────────────────────────────────────────
    yield { type: 'stage', stage: 'retrieve', status: 'start', detail: assertion.id };
    let docs: EvidenceDoc[] = [];
    let retrievalDegraded = false;
    try {
      const toDocs = (hits: Awaited<ReturnType<TavilyClient['search']>>['hits'], requestId: string) =>
        hits.filter(h => !isSourceNavigation(h.url)).map((h) => ({
          url: h.url,
          title: h.title,
          retrievalScore: h.score,
          snippet: h.content.slice(0, isOfficialSource(h.url)
            ? OFFICIAL_ADJUDICATION_EXCERPT_LIMIT : 1200),
          searchRequestId: requestId,
        }));
      const topScore = (ds: EvidenceDoc[]) =>
        ds.length ? Math.max(...ds.map((d) => d.retrievalScore)) : 0;
      const recordSearch = (result: Awaited<ReturnType<TavilyClient['search']>>, query: string,
        kind: typeof searches[number]['kind'], includeDomains: string[] = [],
        depth: 'basic' | 'advanced' = 'basic') => {
        requestIds.push(result.requestId);
        searches.push({assertionId: assertion.id, kind, query, depth, includeDomains,
          requestId: result.requestId, returnedUrls: result.hits.map(hit => hit.url),
          excludedNavigationUrls: result.hits.filter(hit => isSourceNavigation(hit.url)).map(hit => hit.url),
          elapsedMs: result.elapsedMs});
      };

      const search = await tavily.search(assertion.searchQuery, {
        maxResults: opts.resultsPerAssertion,
        signal: opts.signal,
        fetch: opts.fetch,
      });
      recordSearch(search, assertion.searchQuery, 'open');
      let evidenceRequestId = search.requestId;
      docs = toDocs(search.hits, search.requestId);

      // One retry on a visibly bad draw, using the assertion text itself as a
      // different query. Budget-aware: skipped if the retry would exceed the cap.
      //
      // No extra 'start' event is emitted for the retry. Consumers pair each
      // 'start' with exactly one 'done' to drive a progress view, so an
      // unpaired start leaves a row spinning forever. The retry is reported in
      // the retrieve 'done' detail instead. INVARIANT: every 'start' this
      // generator yields is followed by exactly one 'done' for the same stage.
      let retried = false;
      if (topScore(docs) < RETRIEVAL_SCORE_FLOOR) {
        retried = true;
        try {
          const retry = await tavily.search(assertion.text, {
            maxResults: opts.resultsPerAssertion,
            signal: opts.signal,
            fetch: opts.fetch,
          });
          recordSearch(retry, assertion.text, 'recovery');
          const retryDocs = toDocs(retry.hits, retry.requestId);
          if (topScore(retryDocs) > topScore(docs)) {
            docs = retryDocs;
            evidenceRequestId = retry.requestId;
          }
        } catch {
          opts.signal?.throwIfAborted();
          // Budget exhausted or the retry failed; keep the first draw and let
          // the degraded flag below describe what happened.
        }
        retrievalDegraded = topScore(docs) < RETRIEVAL_SCORE_FLOOR;
      }

      // In the opt-in evidence mode, search one unambiguous jurisdiction's
      // official domains only when the available excerpts missed them. Keep the
      // original documents so official-looking but off-topic hits (for example
      // a different visa category) cannot silently replace contrary evidence.
      // The common call budget covers this search and subsequent Extract.
      let scopedCount = 0;
      const domains = issuerDomains;
      if (domains.length && needsOfficialSearch(claim, [...docs, ...officialEvidenceCache], domains, assertion.text) &&
          tavily.callsUsed < opts.tavilyBudget) {
        try {
          const baseQuery = officialSearchQuery(claim, assertion.searchQuery);
          // Keep the French authority-language query monolingual; it already
          // names VAT scope, receipt, issuance and small-business categories.
          const query = domains[0] === 'impots.gouv.fr' ? baseQuery
            : qualifierSearchQuery(baseQuery, assertion.text);
          const collections = officialSearchCollections(claim);
          const scoped = await tavily.search(query, {
            maxResults: opts.resultsPerAssertion,
            includeDomains: collections,
            searchDepth: 'advanced',
            signal: opts.signal,
            fetch: opts.fetch,
          });
          recordSearch(scoped, query, 'official', collections, 'advanced');
          const additions = toDocs(scoped.hits, scoped.requestId)
            .filter(doc => {
              if (!isInSearchScope(doc.url, domains)) return false;
              const existing = docs.find(value => value.url === doc.url);
              return !existing || scopedHitAddsQualifier(assertion.text, existing.snippet, doc.snippet) ||
                scopedHitAddsSection(claim, existing.snippet, doc.snippet) ||
                scopedHitAddsYear(assertion.text, existing.snippet, doc.snippet) ||
                scopedHitAddsGroup(assertion.text, existing.snippet, doc.snippet) ||
                scopedHitAddsBoundary(assertion.text, existing.snippet, doc.snippet) ||
                scopedHitAddsDisposition(assertion.text, existing.snippet, doc.snippet) ||
                scopedHitAddsRoute(assertion.text, existing.snippet, doc.snippet);
            })
            .slice(0, lacksExceptionDisposition(
              [...docs, ...officialEvidenceCache].filter(doc =>
                isInSearchScope(doc.url, domains)).map(doc => doc.snippet).join(' '),
              assertion.text) ? 4 : 2);
          docs = [...docs, ...additions];
          scopedCount = additions.length;
          if (topScore(additions) >= RETRIEVAL_SCORE_FLOOR) retrievalDegraded = false;
        } catch {
          opts.signal?.throwIfAborted();
          // An unavailable scoped search leaves the open-web evidence intact.
        }
      }
      if (opts.inspectSources && officialEvidenceCache.length) {
        const reused = reusableIssuerEvidence(officialEvidenceCache, docs, results);
        docs = [...docs, ...reused];
      }
      retrieved += docs.length;
      yield { type: 'evidence', assertionId: assertion.id, docs, tavilyRequestId: evidenceRequestId };
      yield {
        type: 'stage',
        stage: 'retrieve',
        status: 'done',
        detail: scopedCount ? `${docs.length} doc(s), including ${scopedCount} scoped official-domain result(s)` : retried
          ? `${docs.length} doc(s), retried (top score ${topScore(docs).toFixed(2)})`
          : `${docs.length} doc(s)`,
      };
    } catch (e) {
      opts.signal?.throwIfAborted();
      yield { type: 'error', stage: 'retrieve', message: (e as Error).message };
      // Close the stage even on failure. See the INVARIANT note above: a
      // consumer pairing start/done leaves a row spinning forever otherwise,
      // and this is the error path, where the display matters most.
      yield { type: 'stage', stage: 'retrieve', status: 'done', detail: 'failed' };
      // No evidence retrieved is itself a determinate outcome, not a crash.
      // The verdict event must be yielded here too: consumers build their view
      // from the event stream, so skipping it would leave the stream showing
      // fewer verdicts than the final result contains.
      const failed: AssertionResult = {
        assertion,
        verdict: 'insufficient_evidence',
        confidence: 0,
        citedUrls: [],
        rationale: 'Evidence search failed; this assertion remains unresolved. See the run error reference.',
        conflicted: false,
      };
      results.push(failed);
      yield { type: 'verdict', result: failed };
      continue;
    }

    // Optional source inspection is bounded and cannot turn a failed extraction
    // into lost evidence. A shared budget covers both Search and Extract.
    if (opts.inspectSources && docs.length && !retrievalDegraded) {
      const requestedUrls = sourceInspectionUrls(docs);
      yield { type: 'stage', stage: 'extract', status: 'start', detail: assertion.id };
      let detail = 'No source pages read; using search excerpts';
      const record: SourceInspectionRecord = {
        status: 'failed', requestedUrls, extractedUrls: [], failedUrls: [...requestedUrls],
      };
      sourceInspection[assertion.id] = record;
      // Later assertions still need an open Search and may need one issuer-
      // scoped Search. Do not spend those reserved calls inspecting an earlier
      // assertion's page; an early Extract otherwise starves the decisive
      // exception or transition at the end of a compound claim.
      const remainingAssertions = assertions.length - assertionIndex - 1;
      if (tavily.callsUsed + remainingAssertions * (issuerDomains.length ? 2 : 1)
          >= opts.tavilyBudget) {
        record.status = 'skipped_budget';
        detail = remainingAssertions
          ? 'Call budget reserved for later assertions; using search excerpts'
          : 'Call budget reached; using search excerpts';
      } else if (requestedUrls.length) {
        try {
          // BOE consolidated laws can exceed hundreds of thousands of chars.
          // A full-page local window often lands on site navigation, while
          // Tavily's query-reranked chunks can return both the commencement
          // clause and dated source metadata within one bounded Extract call.
          // Keep the established full-page path for other authorities until
          // their long-document behavior is evaluated separately.
          const extractionQuery = issuerDomains[0] === 'boe.es' && requestedUrls.some(url =>
            isInSearchScope(url, issuerDomains))
            ? officialSearchQuery(claim, assertion.searchQuery) : undefined;
          const extraction = await tavily.extract(requestedUrls, extractionQuery,
            { signal: opts.signal, fetch: opts.fetch });
          requestIds.push(extraction.requestId);
          const inspected = inspectSourceExcerpts(docs, requestedUrls, extraction,
            `${assertion.text} ${assertion.searchQuery}`);
          docs = inspected.docs;
          Object.assign(record, {
            status: inspected.extractedUrls.length === requestedUrls.length ? 'done'
              : inspected.extractedUrls.length ? 'partial' : 'failed',
            requestId: extraction.requestId, extractedUrls: inspected.extractedUrls,
            failedUrls: inspected.failedUrls,
            preservedSearchUrls: inspected.preservedSearchUrls,
            ...(extraction.creditsReported === undefined ? {} : { creditsReported: extraction.creditsReported }),
          });
          detail = `${inspected.extractedUrls.length}/${requestedUrls.length} source pages read`;
          if (inspected.failedUrls.length) detail += '; remaining search excerpts kept';
          if (inspected.preservedSearchUrls.length) detail +=
            `; ${inspected.preservedSearchUrls.length} more-specific Search excerpt(s) kept`;
          yield { type: 'evidence', assertionId: assertion.id, docs, tavilyRequestId: extraction.requestId };
        } catch (e) {
          opts.signal?.throwIfAborted();
          yield { type: 'error', stage: 'extract', message: (e as Error).message };
        }
      }
      yield { type: 'stage', stage: 'extract', status: 'done', detail };
    }

    // Tavily's cleaned text can omit an HTML heading that carries the
    // exception condition. Only a Tavily-discovered URL on the claim's
    // issuing domain may receive this bounded direct read. Keep separate
    // provenance: a direct HTML excerpt is not a Tavily Extract passage.
    if (opts.inspectSources && issuerDomains.length &&
        hasClaimDateRelation(assertion.text, assertion.text)) {
      const missing = [...new Set(docs.filter(doc =>
        isInSearchScope(doc.url, issuerDomains) &&
        (!hasClaimDateRelation(doc.snippet, assertion.text) ||
          lacksExceptionDisposition(doc.snippet, assertion.text))).map(doc => doc.url))]
        .slice(0, lacksExceptionDisposition('', assertion.text) ? 4 : 2);
      if (missing.length) {
        issuerHtmlReads[assertion.id] = [];
        const reads = await Promise.all(missing.map(async url => {
          try {
            return await readIssuerHtml(url, assertion.text, issuerDomains,
              { fetch: opts.fetch, signal: opts.signal });
          } catch {
            opts.signal?.throwIfAborted();
            return null;
          }
        }));
        for (const [index, url] of missing.entries()) {
          const read = reads[index];
          issuerHtmlReads[assertion.id].push({ url, status: read ? 'used' : 'unavailable',
            ...(read ? { bytes: read.bytes } : {}) });
          if (!read) continue;
          docs = docs.map(doc => doc.url === url
            ? { ...doc, snippet: read.excerpt, issuerHtmlRead: true,
              extractionRequestId: undefined }
            : doc);
        }
        yield { type: 'evidence', assertionId: assertion.id, docs,
          tavilyRequestId: docs.find(doc => doc.searchRequestId)?.searchRequestId ??
            requestIds.at(-1) ?? '' };
      }
    }

    // A dated instruction can be indexed more prominently than its current
    // edition. Resolve at most one discovered title through the issuer's
    // contents page, then read that exact same-host link with separate provenance.
    if (opts.inspectSources) {
      const seed = docs.find(doc => currentInstructionTitle(assertion.text, [doc]));
      if (seed) {
        try {
          const current = await discoverCurrentManual(assertion.text, seed,
            {fetch: opts.fetch, signal: opts.signal});
          if (current && !docs.some(doc => doc.url === current.url)) {
            docs = [current, ...docs];
            yield {type: 'evidence', assertionId: assertion.id, docs,
              tavilyRequestId: seed.searchRequestId ?? ''};
          }
        } catch { opts.signal?.throwIfAborted(); }
      }
    }

    // The BOE open-data record is a bounded, issuer-published supplement for
    // publication dates that may be absent from Tavily's law-text extraction.
    // It never supplies an entry-into-force conclusion by itself.
    if (opts.inspectSources && issuerDomains[0] === 'boe.es') {
      const ids = new Set<string>();
      for (const doc of docs) {
        const id = boeDocumentId(doc.url);
        if (!id || ids.has(id) || ids.size >= 2) continue;
        ids.add(id);
        if (!boeMetadataCache.has(id)) {
          if (boeMetadataCache.size >= 3) continue;
          boeMetadataCache.set(id, await readBoeMetadata(doc.url,
            {fetch: opts.fetch, signal: opts.signal}));
        }
        const metadata = boeMetadataCache.get(id);
        if (metadata && !docs.some(existing => existing.url === metadata.url)) docs.push(metadata);
      }
    }

    // 3. Screen (cheap tier, high volume) ──────────────────────────────────
    yield { type: 'stage', stage: 'screen', status: 'start', detail: assertion.id };
    let screened: ScreenedDoc[] = [];
    let unjudged = docs.length;
    try {
      const listing = docs
        .map((d, i) => `[${i}] ${d.title}\n${d.url}\n${d.snippet.slice(0,
          isOfficialSource(d.url) && (d.extractionRequestId || d.issuerDiscovery)
            ? OFFICIAL_ADJUDICATION_EXCERPT_LIMIT : ADJUDICATION_EXCERPT_LIMIT)}`)
        .join('\n\n');
      modelCalls += 1;
      const out = await callTool<{
        judgements: Array<{ index: number; relevant: boolean; leaning: string; reason?: string }>;
      }>({
        model: MODEL_SCREENER,
        user:
          `Assertion: ${assertion.text}\n\n` +
          `For each document below, say whether it bears on the assertion and ` +
          `which way it points.\n\n${listing}`,
        tool: SCREEN_TOOL,
        maxTokens: 2048,
        onDiagnostic: record => modelCallRecords.push({ ...record, stage: 'screen', assertionId: assertion.id }),
        signal: opts.signal,
        fetch: opts.fetch,
      });
      const byIndex = screeningJudgements(out.args.judgements, docs.length);
      unjudged = docs.length - byIndex.size;
      screened = docs.map((d, i) => {
        const j = byIndex.get(i);
        const preservedOfficial = j?.relevant === false &&
          preserveTopicalOfficialSource(assertion.text, d);
        const leaning = preservedOfficial ? 'unclear'
          : j?.leaning === 'supports' || j?.leaning === 'refutes' ? j.leaning : 'unclear';
        // A document the model simply failed to judge must be KEPT, not dropped.
        // Measured 2026-10-08: Nano returned judgements for only 4 of 5 documents.
        // Treating "absent from the response" as "irrelevant" silently discards
        // evidence because the model ran out of steam — the opposite of what the
        // screening step is for. Extra documents cost the adjudicator a little
        // context; dropped documents cannot be recovered.
        return {
          ...d,
          relevant: j === undefined || preservedOfficial ? true : j.relevant,
          leaning: leaning as ScreenedDoc['leaning'],
          reason: preservedOfficial
            ? 'Official source names the assertion subject; kept after screener rejection for adjudication'
            : j === undefined ? 'no valid screening judgement — kept'
            : j.reason ?? 'screener did not provide a reason',
        };
      });
    } catch (e) {
      opts.signal?.throwIfAborted();
      // Screening is an optimisation, not a gate: on failure, pass everything
      // through to the adjudicator rather than dropping evidence silently.
      yield { type: 'error', stage: 'screen', message: (e as Error).message };
      screened = docs.map((d) => ({ ...d, relevant: true, leaning: 'unclear', reason: 'screening failed' }));
    }
    let relevant = screened.filter((d) => d.relevant);
    // If retrieval was healthy but the screener kept nothing, do not believe
    // the screener. Dropping every document is the one screening outcome that
    // cannot be checked downstream — the adjudicator never sees what was lost,
    // and the run reports "insufficient evidence" that is really "we threw the
    // evidence away". Passing everything through costs one longer prompt.
    let screenerOverridden = false;
    if (!relevant.length && screened.length && !retrievalDegraded) {
      relevant = screened.map((d) => ({ ...d, relevant: true, reason: 'screener kept nothing; overridden' }));
      screenerOverridden = true;
    }
    screenedRelevant += relevant.length;
    // Store only passages the screener retained. This includes official URLs
    // found by the open-web draw and the final Search/Extract excerpt actually
    // available to the adjudicator; no new provider request is made to reuse it.
    for (const doc of relevant) {
      if (!isInSearchScope(doc.url, issuerDomains) || officialEvidenceCache.some(cached =>
        cached.url === doc.url && cached.snippet === doc.snippet)) continue;
      officialEvidenceCache.push({ url: doc.url, title: doc.title,
        retrievalScore: doc.retrievalScore, snippet: doc.snippet,
        ...(doc.searchRequestId === undefined ? {} : { searchRequestId: doc.searchRequestId }),
        ...(doc.extractionRequestId === undefined ? {} : { extractionRequestId: doc.extractionRequestId }),
        ...(doc.issuerHtmlRead ? { issuerHtmlRead: true } : {}),
        ...(doc.issuerDiscovery ? { issuerDiscovery: doc.issuerDiscovery } : {}),
      });
    }
    // Three assertions can each add at most two scoped hits; keep their six
    // most recent relevant official passages even when open search also found
    // government material.
    if (officialEvidenceCache.length > 6) officialEvidenceCache.splice(0, officialEvidenceCache.length - 6);
    yield { type: 'screened', assertionId: assertion.id, docs: screenerOverridden ? relevant : screened };
    yield {
      type: 'stage',
      stage: 'screen',
      status: 'done',
      detail: screenerOverridden
        ? `screener kept 0/${screened.length}; overridden, all passed through`
        : unjudged
          ? `${relevant.length}/${screened.length} passed through; ${unjudged} kept without a valid judgement`
          : `${relevant.length}/${screened.length} relevant`,
    };

    // Conflict is computed from the screened evidence, by code, not by a model.
    const conflicted =
      relevant.some((d) => d.leaning === 'supports') && relevant.some((d) => d.leaning === 'refutes');

    if (!relevant.length) {
      // Two very different situations collapse to the same verdict, so the
      // rationale has to separate them. "We searched and the sources do not
      // settle it" is a finding. "Search came back with nothing on topic" is a
      // tooling failure wearing the same clothes, and a reader — or a demo
      // audience — must not be shown the second while believing the first.
      const result: AssertionResult = {
        assertion,
        verdict: 'insufficient_evidence',
        confidence: 0,
        citedUrls: [],
        rationale: retrievalDegraded
          ? 'Retrieval returned nothing on topic (top relevance below ' +
            `${RETRIEVAL_SCORE_FLOOR}, retry did not improve it). This is a search ` +
            'failure, not a judgement that the evidence is inconclusive.'
          : 'Documents were retrieved but none was judged relevant to this assertion.',
        conflicted: false,
      };
      results.push(result);
      yield { type: 'verdict', result };
      continue;
    }

    // 4. Adjudicate (expensive tier, only the hard part) ───────────────────
    yield { type: 'stage', stage: 'adjudicate', status: 'start', detail: assertion.id };
    try {
      // Issuer passages are easiest to miss when five high-ranking secondary
      // hits precede them. Keep every screened document, but present scoped
      // issuer evidence first, then other official hosts, then commentary.
      const evidencePriority = (url: string) =>
        isInSearchScope(url, issuerDomains) ? 0 : isOfficialSource(url) ? 1 : 2;
      const submittedDocs = [...relevant].sort((a, b) =>
        evidencePriority(a.url) - evidencePriority(b.url)).map((d) => ({
        url: d.url, title: d.title, retrievalScore: d.retrievalScore,
        snippet: d.snippet.slice(0, isOfficialSource(d.url) && (d.extractionRequestId || d.issuerDiscovery)
          ? OFFICIAL_ADJUDICATION_EXCERPT_LIMIT : ADJUDICATION_EXCERPT_LIMIT),
        ...(d.searchRequestId === undefined ? {} : { searchRequestId: d.searchRequestId }),
        ...(d.extractionRequestId === undefined ? {} : { extractionRequestId: d.extractionRequestId }),
        ...(d.issuerHtmlRead ? { issuerHtmlRead: true } : {}),
        ...(d.issuerDiscovery ? { issuerDiscovery: d.issuerDiscovery } : {}),
      }));
      adjudicationEvidence[assertion.id] = submittedDocs;
      const evidence = submittedDocs
        .map((d) => `URL: ${d.url}\nTITLE: ${d.title}\nEXCERPT: ${d.snippet}`)
        .join('\n\n---\n\n');
      type AdjudicationArgs = {
        verdict: string;
        confidence: number;
        cited_urls?: string[];
        rationale: string;
      };
      const adjudicate = (maxTokens: number) => {
        modelCalls += 1;
        return callTool<AdjudicationArgs>({
        model: MODEL_ADJUDICATOR,
        system: ADJUDICATOR_SYSTEM,
        user:
          `Assertion: ${assertion.text}\n\n` +
          (conflicted
            ? 'NOTE: the screened documents point in conflicting directions.\n\n'
            : '') +
          `Documents:\n\n${evidence}`,
        tool: ADJUDICATE_TOOL,
        maxTokens,
        onDiagnostic: record => modelCallRecords.push({ ...record, stage: 'adjudicate', assertionId: assertion.id }),
        signal: opts.signal,
        fetch: opts.fetch,
      });
      };
      let out;
      try {
        out = await adjudicate(4096);
      } catch (error) {
        opts.signal?.throwIfAborted();
        const diagnostic = modelCallRecords.at(-1);
        if (diagnostic?.stage !== 'adjudicate' || diagnostic.assertionId !== assertion.id ||
            diagnostic.failureKind !== 'truncated') throw error;
        // Ultra can exhaust 4096 tokens on reasoning alone. One larger retry
        // is bounded to that observed failure, and both attempts remain in the
        // exported diagnostics and model-call count.
        out = await adjudicate(6144);
      }
      adjudicated += 1;
      const allowed = new Set(relevant.map((d) => d.url));
      // A syntactically valid tool response is still untrusted model output.
      // Reject unseen URLs, malformed citation lists, and duplicate sources.
      const cited = [...new Set(
        (Array.isArray(out.args.cited_urls) ? out.args.cited_urls : [])
          .filter((u): u is string => typeof u === 'string' && allowed.has(u)),
      )];
      const validVerdict = (VERDICTS as readonly string[]).includes(out.args.verdict);
      const validFields = typeof out.args.confidence === 'number' &&
        Number.isFinite(out.args.confidence) && out.args.confidence >= 0 && out.args.confidence <= 1 &&
        typeof out.args.rationale === 'string' && out.args.rationale.trim().length > 0 &&
        Array.isArray(out.args.cited_urls) && out.args.cited_urls.every(u => typeof u === 'string');
      const missingCitation =
        (out.args.verdict === 'supported' || out.args.verdict === 'refuted') && !cited.length;
      // Filtering hallucinated citations without also rejecting the conclusion
      // would leave a confident supported/refuted answer with no evidence trail.
      // This enforces provenance, not whether an excerpt entails the claim.
      const accepted = validVerdict && validFields && !missingCitation;
      const verdict: Verdict = accepted
        ? (out.args.verdict as Verdict)
        : 'insufficient_evidence';
      const result: AssertionResult = {
        assertion,
        verdict,
        confidence: accepted
          ? out.args.confidence
          : 0,
        citedUrls: cited,
        rationale: missingCitation
          ? `The model returned ${out.args.verdict} without a citation to the evidence it received. ` +
            'That conclusion was not accepted; the claim remains unresolved.'
          : !validVerdict
            ? 'The model returned an invalid verdict; the claim remains unresolved.'
            : !validFields
              ? 'The model response contained invalid confidence, rationale or citation fields; the claim remains unresolved.'
              : out.args.rationale,
        conflicted,
      };
      results.push(result);
      yield { type: 'verdict', result };
      yield { type: 'stage', stage: 'adjudicate', status: 'done', detail: verdict };
    } catch (e) {
      opts.signal?.throwIfAborted();
      yield { type: 'error', stage: 'adjudicate', message: (e as Error).message };
      yield { type: 'stage', stage: 'adjudicate', status: 'done', detail: 'failed' };
      const result: AssertionResult = {
        assertion,
        verdict: 'insufficient_evidence',
        confidence: 0,
        citedUrls: [],
        rationale: 'Adjudication failed; this assertion remains unresolved. See the run error reference.',
        conflicted,
      };
      results.push(result);
      yield { type: 'verdict', result };
    }
  }

  const overall = rollUpVerdict(results);

  yield {
    type: 'done',
    result: {
      claim,
      assertions: results,
      overall,
      tavilyRequestIds: requestIds,
      provenance: {
        startedAt: new Date(started).toISOString(),
        completedAt: new Date().toISOString(),
        models: { decomposer: decomposerUsed, screener: MODEL_SCREENER, adjudicator: MODEL_ADJUDICATOR },
        ...(wholeClaimFallback ? { decompositionFallback: 'whole_claim' as const } : {}),
        adjudicationEvidence,
        modelCalls: modelCallRecords,
        searches,
        ...(opts.inspectSources ? { sourceInspection } : {}),
        ...(Object.keys(issuerHtmlReads).length ? { issuerHtmlReads } : {}),
      },
      stats: {
        retrieved,
        screenedRelevant,
        adjudicated,
        tavilyCalls: tavily.callsUsed,
        modelCalls,
        elapsedMs: Date.now() - started,
      },
    },
  };
}
