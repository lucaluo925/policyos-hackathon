/**
 * Nebius Token Factory client, scoped to what this pipeline needs.
 *
 * Every constant below is a measured value, not a guess. Evidence lives in
 * ~/Desktop/competitions/nebius-nvidia/probe/capability_matrix.json
 * (5 trials per cell, 2026-10-08):
 *
 *   - Base URL: of the three endpoints the docs mention, only
 *     api.tokenfactory.nebius.com answered; the other two failed to connect.
 *
 *   - tool_choice MUST be a forced function, never "auto". With "auto",
 *     Nano skipped the tool entirely in 1 of 5 trials and answered in prose.
 *     Forced: 5/5 on all three tiers. An agent that silently loses its
 *     structured output 20% of the time is worse than one that cannot do it
 *     at all, because the failure looks like a content bug.
 *
 *   - max_tokens must be generous. These are reasoning models and the
 *     completion budget is spent on reasoning tokens FIRST (Ultra's median was
 *     111 reasoning tokens on a one-sentence task). Too small a budget returns
 *     `content: null` with `finish_reason: "length"` — correctly reported by
 *     the API, but easy to misread as "the model cannot do this".
 *
 *   - Tier latency is NOT a reason to split work: 1.1-2.7s across all three.
 *     The tiering here buys cost, not speed. Do not claim otherwise.
 */

const BASE_URL = 'https://api.tokenfactory.nebius.com/v1';

/**
 * Screening: one call per assertion over a short document list.
 *
 * Measured 2026-10-08 with a positive control (2 relevant documents mixed with
 * 3 obviously irrelevant ones — a recipe, an NBA recap, a houseplant guide):
 *   nano  2/3 trials correct; one trial also discarded a genuinely relevant
 *         source, and it judged only 4 of the 5 documents. 4.4-4.9s.
 *   super 3/3 correct, judged all 5, and labelled leaning correctly. 2.3-2.8s.
 * Nano was slower AND less reliable on both this step and decomposition, so the
 * "cheap tier for volume" premise did not survive measurement.
 * UNRESOLVED: per-token price for Nano is not published in the console, so the
 * cost side of that tradeoff is unverified. Revisit if volume grows.
 */
export const MODEL_SCREENER = 'nvidia/nemotron-3-super-120b-a12b';

/**
 * Decomposition. Measured 2026-10-08 on one claim, slim schema:
 *   nano  8.4s / 602 completion tokens / 3 assertions, two of them restatements
 *   super 1.6s /  91 completion tokens / 1 assertion
 *   ultra 3.4s / 768 completion tokens / 3 assertions, best separation
 * Nano is 5x SLOWER than Super here because it is verbose, not because the task
 * is hard — so "cheap tier for volume" does not apply to this step. Decomposition
 * is one call per run, so terseness and latency win. UNRESOLVED: this is n=1;
 * re-measure across several claims before treating Super as settled.
 */
export const MODEL_DECOMPOSER = 'nvidia/nemotron-3-super-120b-a12b';
/** Adjudication: one Ultra call for every assertion with usable screened evidence. */
export const MODEL_ADJUDICATOR = 'nvidia/Nemotron-3-Ultra-550b-a55b';

/** Below this, reasoning tokens eat the whole budget and content comes back null. */
export const MIN_MAX_TOKENS = 1024;

export function isNemotronConfigured(): boolean {
  return Boolean(process.env.NEBIUS_API_KEY);
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ToolCallOutcome<T> {
  args: T;
  model: string;
  elapsedMs: number;
  usage: {
    promptTokens?: number;
    completionTokens?: number;
    reasoningTokens?: number;
  };
}

export type ModelFailureKind = 'http_error' | 'invalid_response' | 'truncated' | 'tool_mismatch'
  | 'missing_arguments' | 'invalid_arguments' | 'network_error' | 'timeout' | 'aborted';

/** Safe metadata only: never includes prompt text, tool arguments, headers or error bodies. */
export interface ModelCallDiagnostic {
  model: string;
  tool: string;
  outcome: 'tool_returned' | 'failed';
  failureKind?: ModelFailureKind;
  httpStatus?: number;
  finishReason?: 'tool_calls' | 'length' | 'stop' | 'content_filter' | 'function_call' | 'other';
  elapsedMs: number;
  usage: ToolCallOutcome<unknown>['usage'];
}

export class NemotronError extends Error {}

/**
 * One chat completion constrained to a single named tool call, returning the
 * parsed arguments. Throws rather than returning a partial result: a caller
 * that gets an object back still must validate its tool-specific fields.
 */
export async function callTool<T>(
  opts: {
    model: string;
    system?: string;
    user: string;
    tool: ToolSpec;
    maxTokens?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
    fetch?: typeof fetch;
    /** Observability cannot change model output or trigger an additional request. */
    onDiagnostic?: (record: ModelCallDiagnostic) => void;
  },
): Promise<ToolCallOutcome<T>> {
  opts.signal?.throwIfAborted();
  const apiKey = process.env.NEBIUS_API_KEY;
  if (!apiKey) throw new NemotronError('NEBIUS_API_KEY is not set');

  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: 'system', content: opts.system });
  messages.push({ role: 'user', content: opts.user });

  const started = Date.now();
  const diagnostic: ModelCallDiagnostic = { model: opts.model, tool: opts.tool.name,
    outcome: 'failed', failureKind: 'network_error', elapsedMs: 0, usage: {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  try {
    const res = await (opts.fetch ?? fetch)(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: opts.model,
        messages,
        tools: [{ type: 'function', function: opts.tool }],
        // Forced, never "auto" — see the header comment.
        tool_choice: { type: 'function', function: { name: opts.tool.name } },
        max_tokens: Math.max(opts.maxTokens ?? MIN_MAX_TOKENS, MIN_MAX_TOKENS),
        temperature: 0,
      }),
      signal: opts.signal ? AbortSignal.any([controller.signal, opts.signal]) : controller.signal,
    });
    diagnostic.httpStatus = res.status;
    const text = await res.text();
    if (!res.ok) {
      diagnostic.failureKind = 'http_error';
      throw new NemotronError(`Token Factory HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    diagnostic.failureKind = 'invalid_response';
    const data = JSON.parse(text) as {
      choices?: Array<{
        finish_reason?: string;
        message?: { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const choice = data.choices?.[0];
    if (typeof choice?.finish_reason === 'string') {
      diagnostic.finishReason = ['tool_calls', 'length', 'stop', 'content_filter', 'function_call'].includes(choice.finish_reason)
        ? choice.finish_reason as NonNullable<ModelCallDiagnostic['finishReason']> : 'other';
    }
    const count = (value: unknown) => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
    diagnostic.usage = {
      promptTokens: count(data.usage?.prompt_tokens),
      completionTokens: count(data.usage?.completion_tokens),
      reasoningTokens: count(data.usage?.completion_tokens_details?.reasoning_tokens),
    };
    const calls = choice?.message?.tool_calls;
    if (choice?.finish_reason === 'length') {
      diagnostic.failureKind = 'truncated';
      throw new NemotronError('completion truncated (finish_reason=length; raise max_tokens)');
    }
    if (calls?.length !== 1 || calls[0].function?.name !== opts.tool.name) {
      diagnostic.failureKind = 'tool_mismatch';
      throw new NemotronError('response did not contain exactly the requested tool call');
    }
    const raw = calls[0].function?.arguments;
    if (!raw) {
      diagnostic.failureKind = 'missing_arguments';
      // finish_reason is surfaced because 'length' means the budget was spent
      // on reasoning before any tool call was emitted — a fixable caller bug.
      throw new NemotronError(
        `no tool_call returned (finish_reason=${choice?.finish_reason ?? 'unknown'}; ` +
          `if 'length', raise max_tokens)`,
      );
    }
    let args: T;
    try {
      args = JSON.parse(raw) as T;
    } catch (e) {
      diagnostic.failureKind = 'invalid_arguments';
      throw new NemotronError(
        `tool arguments were not valid JSON: ${(e as Error).message}; raw=${raw.slice(0, 200)}`,
      );
    }
    if (args === null || typeof args !== 'object' || Array.isArray(args)) {
      diagnostic.failureKind = 'invalid_arguments';
      throw new NemotronError('tool arguments must be an object');
    }
    diagnostic.outcome = 'tool_returned';
    delete diagnostic.failureKind;
    return {
      args,
      model: opts.model,
      elapsedMs: Date.now() - started,
      usage: { ...diagnostic.usage },
    };
  } finally {
    clearTimeout(timer);
    if (diagnostic.outcome === 'failed') {
      if (opts.signal?.aborted) diagnostic.failureKind = 'aborted';
      else if (controller.signal.aborted) diagnostic.failureKind = 'timeout';
    }
    diagnostic.elapsedMs = Date.now() - started;
    try { opts.onDiagnostic?.({ ...diagnostic, usage: { ...diagnostic.usage } }); }
    catch { /* A failed observer must not turn a usable response into a failed verification. */ }
  }
}
