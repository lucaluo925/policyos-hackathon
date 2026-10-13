/**
 * POST /api/verify — streams a claim verification as Server-Sent Events.
 *
 * Three decisions here are not stylistic; each fixes a specific failure that
 * would otherwise show up in front of a user or a judge.
 *
 * 1. SSE rather than one JSON response.
 *    The pipeline takes roughly 10-20s. A single response means a spinner for
 *    that whole time and no way to tell a slow run from a hung one. Streaming
 *    each stage is also the only honest progress display: what the page shows
 *    is what the pipeline actually did, not an animation on a timer.
 *
 * 2. A padding preamble before the first real event.
 *    WebKit buffers a streaming response until it has received about 1024
 *    bytes (bugs.webkit.org 252413). Without padding, Safari shows nothing and
 *    then everything at once, which destroys the point of streaming — and the
 *    demo video may well be recorded in Safari.
 *
 * 3. Upstream error bodies never reach the client.
 *    `tavily.ts` and `nemotron.ts` put the upstream response body into their
 *    Error messages, which is right for a server log and wrong for a browser.
 *    Every error event is replaced with a stage-specific sentence plus a
 *    reference id; the full text goes to the server log under that id.
 */

import { runVerification, type PipelineOptions } from '@/lib/verify/pipeline';
import { missingConfig } from '@/lib/verify/pipeline';
import type { ReviewPersistence, Stage, VerificationResult, VerifyEvent } from '@/lib/verify/types';
import { CLAIM_MAX_LENGTH } from '@/lib/verify/claim-text';
import { isDatabaseConfigured } from '@/lib/db';
import { reserveSharedVerificationRun, VerificationRunQuotaExceeded } from '@/lib/verify/admission';
import { budgetedModelFetch, configuredModelBudget, ModelBudgetStopped, type ModelBudget } from '@/lib/verify/spend';
import {
  DAILY_ASSERTION_CAP,
  countRecentVerifiedAssertions,
  persistVerification,
} from '@/lib/verify/review-sink';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * Vercel Hobby allows 300s and that is also its maximum, so there is no reason
 * to ask for less. The live path is designed to finish well inside a minute;
 * this ceiling exists so a slow upstream fails as a slow run rather than as a
 * truncated stream.
 */
export const maxDuration = 300;
const RUN_TIMEOUT_MS = 240_000;

/** Enough SSE comment bytes to clear WebKit's ~1024-byte buffer immediately. */
const WEBKIT_PADDING = `: ${'padding '.repeat(140)}\n\n`;

const CLIENT_ERROR_TEXT: Record<Stage, string> = {
  decompose: 'Could not break this claim into checkable parts.',
  retrieve: 'Evidence search failed for one part of this claim.',
  extract: 'Could not read some source pages; search excerpts were kept.',
  screen: 'Could not screen the retrieved documents; all were passed through.',
  adjudicate: 'Could not reach a verdict for one part of this claim.',
};

function sse(event: VerifyEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`;
}

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_STATIC_DEMO_MODE === '1') {
    return Response.json(
      { error: 'This workspace shows a dated recorded run; live verification is paused.' },
      { status: 503 },
    );
  }
  let claim = '';
  let inspectSources = false;
  try {
    const body = (await request.json()) as { claim?: unknown; inspectSources?: unknown };
    claim = typeof body.claim === 'string' ? body.claim.trim() : '';
    if (body.inspectSources !== undefined && typeof body.inspectSources !== 'boolean') {
      return Response.json({ error: 'inspectSources must be a boolean.' }, { status: 400 });
    }
    inspectSources = body.inspectSources === true;
  } catch {
    return Response.json({ error: 'Body must be JSON with a "claim" string.' }, { status: 400 });
  }
  if (!claim) {
    return Response.json({ error: 'A claim is required.' }, { status: 400 });
  }
  if (claim.length > CLAIM_MAX_LENGTH) {
    return Response.json(
      { error: `Claim is too long (max ${CLAIM_MAX_LENGTH} characters).` },
      { status: 400 },
    );
  }

  // Configuration problems are the operator's, not the claim's, and are worth
  // reporting plainly rather than as a stream of failures.
  const missing = missingConfig();
  if (missing.length) {
    return Response.json(
      { error: `Verification is not configured on this deployment (${missing.join(', ')}).` },
      { status: 503 },
    );
  }

  // The completed-assertion counter remains a secondary limit. It misses
  // failed and disconnected runs; the shared reservation below counts every
  // admitted attempt before the first paid provider call.
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const spent = await countRecentVerifiedAssertions(since);
    if (spent >= DAILY_ASSERTION_CAP) {
      return Response.json(
        {
          error:
            'Live verification has hit its daily limit on this deployment. ' +
            'Claim starters can still fill the form; the dated BOE recording remains viewable. ' +
            'Live checks resume within 24 hours.',
        },
        { status: 429 },
      );
    }
  } catch (e) {
    console.error('[verify] could not read the daily usage counter:', e);
  }

  const requiresSharedQuota = process.env.VERCEL === '1' ||
    process.env.VERIFY_REQUIRE_SHARED_QUOTA === '1';
  if (requiresSharedQuota && !isDatabaseConfigured()) {
    return Response.json({ error: 'Shared live verification limit is unavailable.' }, { status: 503 });
  }
  let modelBudget: ModelBudget | undefined;
  if (requiresSharedQuota || process.env.VERIFY_MODEL_BUDGET_ID) {
    try {
      if (!isDatabaseConfigured()) throw new Error('Missing shared budget database');
      modelBudget = configuredModelBudget();
    } catch {
      return Response.json({ error: 'Live verification budget needs operator review.' }, { status: 503 });
    }
  }
  if (isDatabaseConfigured()) {
    try {
      await reserveSharedVerificationRun();
    } catch (error) {
      if (error instanceof VerificationRunQuotaExceeded) {
        return Response.json({ error: 'Live verification has reached its rolling 24-hour run limit.' }, { status: 429 });
      }
      console.error('[verify] could not reserve a live run:', error);
      return Response.json({ error: 'Shared live verification limit is temporarily unavailable.' }, { status: 503 });
    }
  }

  const abort = new AbortController();
  const onDisconnect = () => abort.abort();
  request.signal.addEventListener('abort', onDisconnect, { once: true });
  if (request.signal.aborted) abort.abort();
  // Bound the entire run below the platform ceiling, not just each HTTP call.
  const deadline = setTimeout(() => abort.abort(new Error('Verification run timed out')), RUN_TIMEOUT_MS);
  const options: PipelineOptions = { signal: abort.signal, inspectSources };
  if (modelBudget) options.fetch = budgetedModelFetch(modelBudget, abort);
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (s: string) => {
        if (!cancelled && !request.signal.aborted) controller.enqueue(encoder.encode(s));
      };
      send(WEBKIT_PADDING);
      let finished: VerificationResult | null = null;
      try {
        for await (const event of runVerification(claim, options)) {
          if (event.type === 'done') {
            finished = event.result;
            continue;
          }
          if (event.type === 'error') {
            const ref = crypto.randomUUID().slice(0, 8);
            // Full detail stays server-side, keyed by ref.
            console.error(`[verify:${ref}] ${event.stage}: ${event.message}`);
            send(
              sse({
                type: 'error',
                stage: event.stage,
                message: `${CLIENT_ERROR_TEXT[event.stage]} (ref ${ref})`,
              }),
            );
            continue;
          }
          send(sse(event));
        }

        // Keep the final done event until the review write has an explicit
        // outcome. Earlier stage/verdict events still stream immediately;
        // storage failure never discards the completed evidence result.
        if (finished && !abort.signal.aborted) {
          let reviewPersistence: ReviewPersistence;
          try {
            const outcome = await persistVerification(finished);
            if (outcome.skipped) {
              console.warn(`[verify] not persisted: ${outcome.skipped}`);
              reviewPersistence = { status: 'skipped', savedAssertions: 0 };
            } else {
              reviewPersistence = { status: 'saved', savedAssertions: outcome.persisted.length };
            }
          } catch (e) {
            const ref = crypto.randomUUID().slice(0, 8);
            console.error(`[verify:${ref}] persist failed:`, e);
            reviewPersistence = { status: 'failed', savedAssertions: 0 };
          }
          send(sse({ type: 'done', result: finished, reviewPersistence }));
        }
      } catch (e) {
        if (cancelled || request.signal.aborted) return;
        const ref = crypto.randomUUID().slice(0, 8);
        console.error(`[verify:${ref}] unhandled:`, e);
        send(
          sse({
            type: 'error',
            stage: 'adjudicate',
            message: abort.signal.reason instanceof ModelBudgetStopped
              ? `Live verification stopped at its budget limit or accounting check. Please try the recorded example. (ref ${ref})`
              : abort.signal.aborted
              ? `Verification timed out. Please retry later. (ref ${ref})`
              : `Verification stopped unexpectedly. (ref ${ref})`,
          }),
        );
      } finally {
        clearTimeout(deadline);
        request.signal.removeEventListener('abort', onDisconnect);
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      abort.abort();
      clearTimeout(deadline);
      request.signal.removeEventListener('abort', onDisconnect);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
