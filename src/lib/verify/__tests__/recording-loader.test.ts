import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { loadPublicRecording } from '../recording-loader';

const recording = JSON.parse(readFileSync('public/verify-recordings/boe-service-passport-adjudication-20261012.json', 'utf8'));

test('a real public recording loads without changing its historical evidence', async () => {
  assert.deepEqual(await loadPublicRecording('/recording', {
    fetch: async () => Response.json(recording),
  }), recording);
});

for (const stalled of ['headers', 'body']) {
  test(`a stalled recording ${stalled} times out and cancels the request`, async () => {
    let signal: AbortSignal | null | undefined;
    const never = new Promise<Response>(() => {});
    await assert.rejects(loadPublicRecording('/recording', {
      timeoutMs: 5,
      fetch: async (_, init) => {
        signal = init?.signal;
        return stalled === 'headers' ? never : {
          ok: true, json: () => new Promise(() => {}),
        } as unknown as Response;
      },
    }), /timed out/);
    assert.equal(signal?.aborted, true);
    // A failed attempt does not poison the next load.
    assert.deepEqual(await loadPublicRecording('/recording', {
      fetch: async () => Response.json(recording),
    }), recording);
  });
}

test('failed responses and undisclosed recording scope do not become displayed reports', async () => {
  await assert.rejects(loadPublicRecording('/recording', {
    fetch: async () => new Response('unavailable', { status: 503 }),
  }), /unavailable/);
  await assert.rejects(loadPublicRecording('/recording', {
    fetch: async () => Response.json({}),
  }), /scope/);
});
