/**
 * Claim verification — domain types.
 *
 * Design note on why `insufficient_evidence` is a first-class verdict rather
 * than a fallback: this pipeline feeds `ReviewQueueItem`, and the V10
 * auto-resolver already refuses to auto-approve anything carrying
 * `VerificationMethod.ai_inferred` at low/unverified confidence. A model that
 * is allowed to say "I could not tell" produces honest low-confidence rows the
 * resolver can quarantine. A model forced to pick true/false produces
 * confident-looking rows that the resolver has no reason to stop. The verdict
 * vocabulary is therefore part of the safety design, not cosmetics.
 */

/** Mirrors the three outcomes the adjudicator is allowed to return. */
import type { ModelCallDiagnostic } from './nemotron';

export const VERDICTS = ['supported', 'refuted', 'insufficient_evidence'] as const;
/** What the adjudicator may say about ONE assertion. Keep this list in sync with
 *  the `record_verdict` tool enum — the model is only ever offered these three. */
export type Verdict = (typeof VERDICTS)[number];

/** Shared by the prompt builder and the evidence record. */
export const ADJUDICATION_EXCERPT_LIMIT = 900;
/** Multiple query-reranked Extract chunks can contain a rule and its separate
 * publication metadata. Keep a bounded longer excerpt for official hosts. */
export const OFFICIAL_ADJUDICATION_EXCERPT_LIMIT = 2400;

/**
 * What the whole claim rolls up to. Currently the same set as Verdict.
 *
 * A fourth value, `partially_supported`, existed for about an hour on
 * 2026-10-08 and was removed after the minimal-pair probe showed it labelled
 * flatly false claims as partly true — see rollUpVerdict() for the mechanism.
 * The alias is kept because the roll-up and a single assertion are different
 * questions and the next attempt at this will widen it again.
 */
export const OVERALL_VERDICTS = VERDICTS;
export type OverallVerdict = (typeof OVERALL_VERDICTS)[number];

/** One atomic, independently checkable assertion extracted from a claim. */
export interface Assertion {
  id: string;
  text: string;
}

/** A retrieved document, before any model has judged it. */
export interface EvidenceDoc {
  url: string;
  title: string;
  /** Tavily's own relevance score for the query. Not a truth score. */
  retrievalScore: number;
  snippet: string;
  /** Search request that returned this URL; important when open and scoped searches are merged. */
  searchRequestId?: string;
  /** Present only when this excerpt came from Tavily Extract rather than Search. */
  extractionRequestId?: string;
  /** Direct, bounded HTML read of the Tavily-discovered issuer URL. */
  issuerHtmlRead?: boolean;
}

export interface SourceInspectionRecord {
  status: 'done' | 'partial' | 'failed' | 'skipped_budget';
  requestedUrls: string[];
  extractedUrls: string[];
  failedUrls: string[];
  /** Extract succeeded, but the Search excerpt retained more specific claim terms. */
  preservedSearchUrls?: string[];
  requestId?: string;
  /** API-reported credits can be zero before a batch of five is billed. */
  creditsReported?: number;
}

/** A retrieved document after cheap-tier relevance screening. */
export interface ScreenedDoc extends EvidenceDoc {
  relevant: boolean;
  /** Which direction this document points, if the screener could tell. */
  leaning: 'supports' | 'refutes' | 'unclear';
  reason: string;
}

export interface AssertionResult {
  assertion: Assertion;
  verdict: Verdict;
  /** Model-reported, 0..1. Treated as a claim by the model, not a measurement. */
  confidence: number;
  /** URLs the adjudicator actually cited. Subset of the screened set. */
  citedUrls: string[];
  rationale: string;
  /** True when screened evidence pointed both ways — the resolver quarantines these. */
  conflicted: boolean;
}

export interface VerificationResult {
  claim: string;
  assertions: AssertionResult[];
  /** See rollUpVerdict() in pipeline.ts for the precedence and why. */
  overall: OverallVerdict;
  /** Every Tavily request id, so the evidence trail is reproducible. */
  tavilyRequestIds: string[];
  /** Absent in older recordings. Never infer historical model names or timestamps. */
  provenance?: {
    startedAt: string;
    completedAt: string;
    models: { decomposer: string; screener: string; adjudicator: string };
    /** The original claim was kept whole after both decomposition transports failed. */
    decompositionFallback?: 'whole_claim';
    /** Exact search excerpts submitted to adjudication, including failed calls. */
    adjudicationEvidence: Record<string, EvidenceDoc[]>;
    /** Absent means this optional mode was not used or an older run did not record it. */
    sourceInspection?: Record<string, SourceInspectionRecord>;
    /** Direct issuer HTML reads are separate from Tavily Search/Extract IDs. */
    issuerHtmlReads?: Record<string, Array<{ url: string; status: 'used' | 'unavailable'; bytes?: number }>>;
    /** Metadata from actual model invocations; older recordings retain its absence. */
    modelCalls?: Array<ModelCallDiagnostic & { stage: 'decompose' | 'screen' | 'adjudicate'; assertionId?: string }>;
  };
  stats: {
    retrieved: number;
    screenedRelevant: number;
    adjudicated: number;
    tavilyCalls: number;
    modelCalls: number;
    elapsedMs: number;
  };
}

/** Review storage is a separate outcome from the model's evidence verdict. */
export type ReviewPersistence =
  | { status: 'saved'; savedAssertions: number }
  | { status: 'skipped' | 'failed'; savedAssertions: 0 };

/** Streamed to the UI (and to the smoke script) as the pipeline runs. */
export type VerifyEvent =
  | { type: 'stage'; stage: Stage; status: 'start' | 'done'; detail?: string }
  | { type: 'assertions'; assertions: Assertion[] }
  | { type: 'evidence'; assertionId: string; docs: EvidenceDoc[]; tavilyRequestId: string }
  | { type: 'screened'; assertionId: string; docs: ScreenedDoc[] }
  | { type: 'verdict'; result: AssertionResult }
  | { type: 'done'; result: VerificationResult; reviewPersistence?: ReviewPersistence }
  | { type: 'error'; stage: Stage; message: string };

export type Stage = 'decompose' | 'retrieve' | 'extract' | 'screen' | 'adjudicate';
