import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ABANDONED_AFTER_MS,
  isFailureState,
  runState,
  runStateLabel,
  runStateTone,
} from '../run-outcome';

const NOW = new Date('2026-10-11T04:00:00Z');
const ago = (msBack: number) => new Date(NOW.getTime() - msBack);

test('a completed run keeps its recorded status', () => {
  for (const status of ['success', 'partial_success', 'failed', 'skipped']) {
    assert.equal(runState({ status, startedAt: ago(90_000), completedAt: ago(60_000) }, NOW), status);
  }
});

test('an in-flight run is running, not partial', () => {
  assert.equal(runState({ status: 'partial', startedAt: ago(5_000), completedAt: null }, NOW), 'running');
});

test('a run still in flight past the threshold was killed', () => {
  assert.equal(
    runState({ status: 'partial', startedAt: ago(ABANDONED_AFTER_MS + 1_000), completedAt: null }, NOW),
    'abandoned',
  );
});

test('the threshold boundary counts as abandoned', () => {
  assert.equal(
    runState({ status: 'partial', startedAt: ago(ABANDONED_AFTER_MS), completedAt: null }, NOW),
    'abandoned',
  );
  assert.equal(
    runState({ status: 'partial', startedAt: ago(ABANDONED_AFTER_MS - 1), completedAt: null }, NOW),
    'running',
  );
});

test('completedAt is a required field, so it cannot be silently absent', () => {
  // The type makes omission a compile error; this pins the null behaviour the
  // requirement protects.
  assert.equal(
    runState({ status: 'partial', startedAt: ago(ABANDONED_AFTER_MS + 1), completedAt: null }, NOW),
    'abandoned',
  );
});

test('a yesterday run left in flight is abandoned, which is the real case', () => {
  // canada-immigration: status "partial", completedAt null, started hours ago.
  assert.equal(
    runState({ status: 'partial', startedAt: '2026-10-11T00:00:00Z', completedAt: null }, NOW),
    'abandoned',
  );
});

test('an unparseable startedAt does not get promoted to abandoned', () => {
  assert.equal(runState({ status: 'partial', startedAt: 'not a date', completedAt: null }, NOW), 'running');
});

test('a string completedAt still counts as completed', () => {
  assert.equal(
    runState({ status: 'success', startedAt: '2026-10-11T03:00:00Z', completedAt: '2026-10-11T03:00:30Z' }, NOW),
    'success',
  );
});

test('abandoned counts as a failure for stability, running does not', () => {
  assert.equal(isFailureState('abandoned'), true);
  assert.equal(isFailureState('failed'), true);
  assert.equal(isFailureState('running'), false);
  assert.equal(isFailureState('success'), false);
  assert.equal(isFailureState('partial_success'), false);
});

test('abandoned reads as "did not finish", never as "partial"', () => {
  assert.equal(runStateLabel('abandoned'), 'did not finish');
  assert.notEqual(runStateLabel('abandoned'), 'partial');
  assert.equal(runStateTone('abandoned'), 'bad');
});

test('a success is green and a killed run is not amber', () => {
  assert.equal(runStateTone('success'), 'ok');
  assert.notEqual(runStateTone('abandoned'), 'warn');
});
