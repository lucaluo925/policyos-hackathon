import type { RecordedVerification } from './report';

/** Bound both response headers and body parsing so a stalled recording cannot
 * indefinitely lock the live form. No provider request is made here. */
export async function loadPublicRecording(
  url: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<RecordedVerification> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('Recording load timed out'));
    }, options.timeoutMs ?? 15_000);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await (options.fetch ?? fetch)(url, { signal: controller.signal });
      if (!response.ok) throw new Error('Recording unavailable');
      const example = await response.json() as RecordedVerification;
      if (!['adjudication_only', 'selected_adjudication'].includes(example?.publicEvidenceScope ?? '') || !example.sourceAttribution) {
        throw new Error('Unexpected recording scope');
      }
      return example;
    })()]);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
