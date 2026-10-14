import type { VerifyEvent } from './types';

export class IncompleteVerificationError extends Error {
  constructor() {
    super('Verification stream ended without a result');
    this.name = 'IncompleteVerificationError';
  }
}

/** A closed HTTP stream alone is not a completed verification. */
export async function consumeVerificationStream(
  body: ReadableStream<Uint8Array>,
  apply: (event: VerifyEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let event: VerifyEvent;
        try { event = JSON.parse(line.slice(5).trim()) as VerifyEvent; } catch {
          // Do not silently lose an evidence event and later claim completion.
          throw new IncompleteVerificationError();
        }
        apply(event);
        // The server emits done only after the review write outcome is known.
        // Do not wait for a proxy to close the transport after that result.
        if (event?.type === 'done') return;
      }
    }
    // Stage errors can be recoverable. Only the final result confirms completion.
    throw new IncompleteVerificationError();
  } finally {
    // Stop consuming on parse/callback failure too, propagating cancellation
    // instead of leaving an abandoned paid request running server-side.
    try { await reader.cancel(); } catch { /* Preserve the original failure. */ }
    reader.releaseLock();
  }
}
