import assert from 'node:assert/strict';
import { test } from 'node:test';
import { consumeVerificationStream, IncompleteVerificationError } from '../stream';

function chunks(text: string) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({ start(controller) {
    // Split every byte, including inside UTF-8 and frame delimiters.
    for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
}

test('a truncated SSE stream cannot look like a successful finish', async () => {
  await assert.rejects(consumeVerificationStream(chunks('data: {"type":"stage","stage":"decompose","status":"start"}\n\n'), () => {}), /without a result/);
});
test('padding and byte boundaries preserve UTF-8 events and a final result', async () => {
  const events: unknown[] = [];
  await consumeVerificationStream(chunks(': padding\n\ndata: {"type":"done","result":{"claim":"政策"}}\n\n'), e => events.push(e));
  assert.deepEqual(events, [{ type: 'done', result: { claim: '政策' } }]);
});
test('a terminal decomposition error retains its detail and reports an incomplete run', async () => {
  const events: unknown[] = [];
  await assert.rejects(consumeVerificationStream(chunks('data: {"type":"error","stage":"decompose","message":"failed"}\n\n'), e => events.push(e)), IncompleteVerificationError);
  assert.equal(events.length, 1);
});

for (const stage of ['retrieve', 'extract', 'screen', 'adjudicate']) {
  test(`a recoverable ${stage} error does not hide a later truncated stream`, async () => {
    const events: unknown[] = [];
    const prefix = `data: ${JSON.stringify({ type: 'error', stage, message: 'recoverable' })}\n\n`
      + 'data: {"type":"stage","stage":"adjudicate","status":"start"}\n\n';
    await assert.rejects(consumeVerificationStream(chunks(prefix), e => events.push(e)), IncompleteVerificationError);
    assert.equal(events.length, 2);
    // The same warning followed by an actual final result is a completed run.
    await consumeVerificationStream(chunks(prefix + 'data: {"type":"done","result":{"claim":"test"}}\n\n'), () => {});
  });
}

test('a corrupt evidence event cannot be silently dropped before a final result', async () => {
  let cancelled = false;
  const events: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(
      'data: {"type":"evidence",BROKEN}\n\ndata: {"type":"done","result":{}}\n\n')); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(consumeVerificationStream(body, event => events.push(event)), IncompleteVerificationError);
  assert.deepEqual(events, []);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test('the final result completes without waiting for transport close', { timeout: 1000 }, async () => {
  let cancelled = false;
  const events: unknown[] = [];
  const body = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new TextEncoder().encode(
      'data: {"type":"done","result":{"claim":"final"}}\n\n')); },
    cancel() { cancelled = true; },
  });
  await consumeVerificationStream(body, event => events.push(event));
  assert.equal(events.length, 1);
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});
