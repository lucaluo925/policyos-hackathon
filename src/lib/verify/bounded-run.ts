/** Opt-in headless authorization boundary. No default transport, credentials, or live CLI.
 * Byte bounds are exact. Token/price bounds require separately verified provider facts;
 * a chars/4 estimate or synthetic test tokenizer is never a live preflight.
 */
import { MODEL_DECOMPOSER, MODEL_ADJUDICATOR } from './nemotron';
import { runVerification } from './pipeline';
import { VERDICTS, type VerificationResult } from './types';

export const APPROVED_PUBLIC_CLAIM = 'The United Kingdom left the European Union on 31 January 2020.';
export const BOUNDED_STEPS = [
  { model: MODEL_DECOMPOSER, tool: 'record_assertions', output: 3072, input: 1500, bytes: 8192 },
  { model: null, tool: 'search', output: 0, input: 0, bytes: 2048 },
  { model: MODEL_DECOMPOSER, tool: 'record_screening', output: 2048, input: 4000, bytes: 24576 },
  { model: MODEL_ADJUDICATOR, tool: 'record_verdict', output: 4096, input: 5000, bytes: 32768 },
] as const;
const MODEL_URL = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
const SEARCH_URL = 'https://api.tavily.com/search';
type Json = Record<string, unknown>;
function object(value: unknown): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('expected object');
  return value as Json;
}
function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && !!value.trim() && Buffer.byteLength(value, 'utf8') <= max;
}
function fields(value: Json, allowed: string[]) {
  if (Object.keys(value).some(k => !allowed.includes(k))) throw new Error('unexpected response field');
}
export interface BoundedApproval {
  /** Human authorization for this one run, after independent read-only preflight. */
  approved: true;
  claim: typeof APPROVED_PUBLIC_CLAIM;
  validUntil: number;
  /** Confirmed gift balance and this run's approved gift spend, USD including tax. */
  giftBalanceUsd: number;
  giftSpendCapUsd: number;
  cashSpendCapUsd: 0;
  payAsYouGoDisabled: true;
  /** Separate Tavily account: Nebius gift USD cannot pay for search credits. */
  tavilyCreditsAvailable: number;
  tavilyCreditsValidUntil: number;
  checkedAt: number;
  /** Exact rates, including reasoning in completion rate; no cached discounts assumed. */
  rates: Record<string, { inputPerMillionUsd: number; outputPerMillionUsd: number }>;
  tavilyBasicUsd: number;
  taxMultiplier: number;
  tokenizer: {
    identity: string;
    /** Evidence reference for exact model templates + tool/schema/framing accounting. */
    verifiedBasis: string;
    upperBound(model: string, wireBody: Readonly<Json>): number;
  };
}
export interface BoundedRecord {
  stage: string;
  model: string | null;
  requestBytes: number;
  inputTokenBound: number;
  reservedUsd: number;
  promptTokens?: number;
  completionTokens?: number;
  providerRequestId?: string;
}
function cost(input: number, output: number, rate: BoundedApproval['rates'][string], tax: number) {
  return Math.ceil(((input * rate.inputPerMillionUsd + output * rate.outputPerMillionUsd) / 1e6) * tax * 1e9) / 1e9;
}
function preflight(approval: BoundedApproval, now: number): number {
  if (!approval || approval.approved !== true || approval.claim !== APPROVED_PUBLIC_CLAIM ||
      approval.cashSpendCapUsd !== 0 || approval.payAsYouGoDisabled !== true ||
      !Number.isFinite(approval.tavilyCreditsAvailable) || approval.tavilyCreditsAvailable < 1 ||
      !Number.isFinite(approval.tavilyCreditsValidUntil) || approval.tavilyCreditsValidUntil <= now ||
      !Number.isFinite(approval.validUntil) || approval.validUntil <= now ||
      !Number.isFinite(approval.checkedAt) || approval.checkedAt > now || now - approval.checkedAt > 3600_000 ||
      !approval.tokenizer?.identity?.trim() || !approval.tokenizer.verifiedBasis?.trim() ||
      typeof approval.tokenizer.upperBound !== 'function') throw new Error('bounded preflight incomplete');
  for (const n of [approval.giftBalanceUsd, approval.giftSpendCapUsd, approval.tavilyBasicUsd, approval.taxMultiplier]) {
    if (!Number.isFinite(n) || n < 0) throw new Error('invalid billing preflight');
  }
  if (approval.taxMultiplier < 1 || approval.tavilyBasicUsd <= 0) throw new Error('invalid billing preflight');
  let maximum = approval.tavilyBasicUsd * approval.taxMultiplier;
  let nebiusMaximum = 0;
  for (const step of BOUNDED_STEPS) {
    if (!step.model) continue;
    const rate = approval.rates?.[step.model];
    if (!rate || [rate.inputPerMillionUsd, rate.outputPerMillionUsd].some(n => !Number.isFinite(n) || n <= 0)) {
      throw new Error('exact model rates unverified');
    }
    const modelMaximum = cost(step.input, step.output, rate, approval.taxMultiplier);
    maximum += modelMaximum;
    nebiusMaximum += modelMaximum;
  }
  if (nebiusMaximum > approval.giftBalanceUsd || maximum > approval.giftSpendCapUsd) throw new Error('insufficient approved gift budget');
  return maximum;
}
async function abortable<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try { return await Promise.race([pending, aborted]); }
  finally { signal.removeEventListener('abort', onAbort); }
}
async function boundedJson(response: Response, signal: AbortSignal): Promise<Json> {
  const reader = response.clone().body?.getReader();
  if (!reader) throw new Error('empty response');
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (;;) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 262144) throw new Error('response byte budget exceeded');
      chunks.push(part.value);
    }
    return object(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
}

/** One-shot transport. Failure aborts the shared pipeline before its fallback/retry paths.
 * Reservation precedes I/O; failed requests remain possibly billed. Never log headers/raw bodies.
 */
export function createBoundedTransport(options: {
  approval: BoundedApproval;
  fetch: typeof fetch;
  controller: AbortController;
}) {
  const { controller } = options;
  // Snapshot caller-owned billing facts: later mutations cannot expand this run.
  const approval: BoundedApproval = { ...options.approval, rates: Object.fromEntries(
    Object.entries(options.approval?.rates ?? {}).map(([model, rate]) => [model, { ...rate }]),
  ), tokenizer: { ...options.approval?.tokenizer } };
  const ceilingUsd = preflight(approval, Date.now());
  if (typeof options.fetch !== 'function') throw new Error('explicit transport required');
  const startedAt = Date.now();
  let busy = false;
  let sealed = false;
  let reservedUsd = 0;
  let retrievedUrls: string[] = [];
  const records: BoundedRecord[] = [];
  const fail = () => {
    const error = new Error('Bounded run stopped: request, response, or budget validation failed');
    controller.abort(error);
    return error;
  };
  const guarded: typeof fetch = async (input, init) => {
    let received: Response | undefined;
    try {
      controller.signal.throwIfAborted();
      if (sealed || busy || records.length >= BOUNDED_STEPS.length || Date.now() >= approval.validUntil || Date.now() - startedAt >= 120_000) throw fail();
      if (typeof input !== 'string' || init?.method !== 'POST' || typeof init.body !== 'string') throw fail();
      const step = BOUNDED_STEPS[records.length];
      if (input !== (step.model ? MODEL_URL : SEARCH_URL)) throw fail();
      const requestBytes = Buffer.byteLength(init.body, 'utf8');
      if (requestBytes > step.bytes) throw fail();
      const body = object(JSON.parse(init.body));
      let inputTokenBound = 0;
      let reservation: number;
      if (step.model) {
        fields(body, ['model', 'messages', 'tools', 'tool_choice', 'max_tokens', 'temperature']);
        const choice = object(body.tool_choice);
        if (body.model !== step.model || choice.type !== 'function' || object(choice.function).name !== step.tool ||
            !integer(body.max_tokens) || body.max_tokens !== step.output || body.temperature !== 0 ||
            !Array.isArray(body.messages) || !body.messages.length || body.messages.some(m => {
              const item = object(m);
              return !['system', 'user'].includes(String(item.role)) || typeof item.content !== 'string';
            }) || !Array.isArray(body.tools) || body.tools.length !== 1 ||
            object(object(body.tools[0]).function).name !== step.tool) throw fail();
        if (records.length === 0 && !(object(body.messages[body.messages.length - 1]).content as string).endsWith(`Claim: ${APPROVED_PUBLIC_CLAIM}`)) throw fail();
        inputTokenBound = approval.tokenizer.upperBound(step.model, body);
        if (!integer(inputTokenBound) || inputTokenBound <= 0 || inputTokenBound > step.input) throw fail();
        reservation = cost(inputTokenBound, step.output, approval.rates[step.model], approval.taxMultiplier);
      } else {
        fields(body, ['query', 'max_results', 'search_depth']);
        if (!text(body.query, 1024) || body.max_results !== 5 || body.search_depth !== 'basic') throw fail();
        reservation = approval.tavilyBasicUsd * approval.taxMultiplier;
      }
      if (reservedUsd + reservation > ceilingUsd || reservedUsd + reservation > approval.giftSpendCapUsd) throw fail();
      const record: BoundedRecord = { stage: step.tool, model: step.model, requestBytes, inputTokenBound, reservedUsd: reservation };
      records.push(record);
      reservedUsd += reservation;
      busy = true;
      const signals = [controller.signal, AbortSignal.timeout(Math.max(1, Math.min(120_000 - (Date.now() - startedAt), approval.validUntil - Date.now(), approval.tavilyCreditsValidUntil - Date.now())))];
      if (init.signal) signals.push(init.signal);
      const signal = AbortSignal.any(signals);
      const response = await abortable(options.fetch(input, { ...init, signal }), signal);
      received = response;
      if (!response.ok) throw fail();
      const data = await boundedJson(response, signal);
      if (step.model) {
        const usage = object(data.usage);
        if (!integer(usage.prompt_tokens) || !integer(usage.completion_tokens) || usage.prompt_tokens > inputTokenBound || usage.completion_tokens > step.output) throw fail();
        if (usage.completion_tokens_details !== undefined) {
          const reasoning = object(usage.completion_tokens_details).reasoning_tokens;
          if (reasoning !== undefined && (!integer(reasoning) || reasoning > usage.completion_tokens)) throw fail();
        }
        if (!Array.isArray(data.choices) || data.choices.length !== 1) throw fail();
        const choice = object(data.choices[0]);
        const calls = object(choice.message).tool_calls;
        if (choice.finish_reason !== 'tool_calls' || !Array.isArray(calls) || calls.length !== 1) throw fail();
        const fn = object(object(calls[0]).function);
        if (fn.name !== step.tool || typeof fn.arguments !== 'string') throw fail();
        const args = object(JSON.parse(fn.arguments));
        if (step.tool === 'record_assertions') {
          fields(args, ['assertions']);
          if (!Array.isArray(args.assertions) || args.assertions.length !== 1) throw fail();
          const assertion = object(args.assertions[0]);
          fields(assertion, ['text', 'search_query']);
          if (!text(assertion.text, 1024) || !text(assertion.search_query, 1024)) throw fail();
        } else if (step.tool === 'record_screening') {
          fields(args, ['judgements']);
          if (!Array.isArray(args.judgements) || args.judgements.length !== retrievedUrls.length) throw fail();
          const indexes = new Set<number>();
          for (const item of args.judgements) {
            const j = object(item);
            fields(j, ['index', 'relevant', 'leaning', 'reason']);
            if (!integer(j.index) || j.index >= retrievedUrls.length || indexes.has(j.index) || typeof j.relevant !== 'boolean' ||
                !['supports', 'refutes', 'unclear'].includes(String(j.leaning)) || (j.reason !== undefined && typeof j.reason !== 'string')) throw fail();
            indexes.add(j.index);
          }
        } else {
          fields(args, ['verdict', 'confidence', 'cited_urls', 'rationale']);
          if (!(VERDICTS as readonly unknown[]).includes(args.verdict) || typeof args.confidence !== 'number' ||
              !Number.isFinite(args.confidence) || args.confidence < 0 || args.confidence > 1 || !text(args.rationale, 16384) ||
              !Array.isArray(args.cited_urls) || args.cited_urls.some(u => typeof u !== 'string' || !retrievedUrls.includes(u)) ||
              (args.verdict !== 'insufficient_evidence' && !args.cited_urls.length)) throw fail();
        }
        record.promptTokens = usage.prompt_tokens;
        record.completionTokens = usage.completion_tokens;
        if (typeof data.id === 'string') record.providerRequestId = data.id;
      } else {
        if (!text(data.request_id, 1024) || !Array.isArray(data.results) || !data.results.length || data.results.length > 5) throw fail();
        retrievedUrls = data.results.map(item => {
          const doc = object(item);
          if (!text(doc.url, 2048) || !/^https?:\/\//.test(doc.url) || !text(doc.title, 2048) || !text(doc.content, 65536) ||
              typeof doc.score !== 'number' || !Number.isFinite(doc.score) || doc.score < 0 || doc.score > 1) throw fail();
          return doc.url;
        });
        if (!data.results.some(item => (object(item).score as number) >= 0.3)) throw fail();
        record.providerRequestId = data.request_id as string;
      }
      controller.signal.throwIfAborted();
      return response;
    } catch {
      void received?.body?.cancel().catch(() => {});
      throw fail();
    }
    finally { busy = false; }
  };
  return {
    fetch: guarded,
    ceilingUsd,
    get records(): readonly BoundedRecord[] { return records.map(r => ({ ...r })); },
    seal() { sealed = true; },
  };
}

export class BoundedRunError extends Error {
  constructor(readonly requests: readonly BoundedRecord[], readonly ceilingUsd: number) {
    super('Bounded run stopped; attempted requests may still be billed.');
  }
}

/** No database writes, retries, concurrent requests, automatic approval, or live entrypoint. */
export async function runBoundedVerification(options: {
  approval: BoundedApproval;
  fetch: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<{ result: VerificationResult; requests: readonly BoundedRecord[]; ceilingUsd: number }> {
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? 120_000;
  if (!Number.isSafeInteger(timeout) || timeout <= 0 || timeout > 120_000) throw new Error('invalid bounded deadline');
  const bounded = createBoundedTransport({ approval: options.approval, fetch: options.fetch, controller });
  const stop = () => controller.abort(new Error('Bounded run interrupted'));
  options.signal?.throwIfAborted();
  options.signal?.addEventListener('abort', stop, { once: true });
  const timer = setTimeout(stop, Math.min(timeout, options.approval.validUntil - Date.now(), options.approval.tavilyCreditsValidUntil - Date.now()));
  try {
    for await (const event of runVerification(APPROVED_PUBLIC_CLAIM, {
      maxAssertions: 1, tavilyBudget: 1, resultsPerAssertion: 5, inspectSources: false,
      decomposeModel: MODEL_DECOMPOSER, signal: controller.signal, fetch: bounded.fetch,
    })) {
      if (event.type === 'error') throw new Error('Bounded pipeline failed; no additional calls authorized');
      if (event.type === 'done') {
        if (bounded.records.length !== 4 || event.result.stats.modelCalls !== 3 || event.result.stats.tavilyCalls !== 1 ||
            event.result.assertions.length !== 1) throw new Error('Bounded run did not complete the approved sequence');
        // Pipeline provenance records only the documents actually given to Ultra.
        const result = event.result.assertions[0];
        const allowed = event.result.provenance?.adjudicationEvidence[result.assertion.id] ?? [];
        if (result.citedUrls.some(url => !allowed.some(doc => doc.url === url))) throw new Error('Citation was not submitted to adjudication');
        return { result: event.result, requests: bounded.records, ceilingUsd: bounded.ceilingUsd };
      }
    }
    throw new Error('Bounded pipeline ended without completion');
  } catch {
    throw new BoundedRunError(bounded.records, bounded.ceilingUsd);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', stop);
    bounded.seal();
    controller.abort(new Error('Bounded run closed'));
  }
}
