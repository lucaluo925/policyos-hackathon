import type { VerifyEvent } from './types';

/** A closed HTTP stream alone is not a completed verification. */
export async function consumeVerificationStream(
  body: ReadableStream<Uint8Array>,
  apply: (event: VerifyEvent) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let completed = false;
  let reportedError = false;
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
        try { event = JSON.parse(line.slice(5).trim()) as VerifyEvent; } catch { continue; }
        if (event?.type === 'done') completed = true;
        if (event?.type === 'error') reportedError = true;
        apply(event);
      }
    }
    if (!completed && !reportedError) throw new Error('Verification stream ended without a result');
  } finally {
    reader.releaseLock();
  }
}
