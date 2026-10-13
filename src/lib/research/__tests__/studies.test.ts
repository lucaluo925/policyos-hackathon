import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { EVENT_STUDIES, POLICY_CONTROL_EVENTS, POLICY_EVENTS_STUDIED } from '../studies';

const ROOT = process.cwd();

/** Minimal CSV reader: these files have no quoted commas in the direction column. */
function directions(relPath: string): string[] {
  const lines = readFileSync(join(ROOT, relPath), 'utf8').trim().split('\n');
  const header = lines[0].split(',');
  const col = header.indexOf('direction');
  assert.ok(col >= 0, `${relPath} has no direction column`);
  return lines.slice(1).map((line) => line.split(',')[col]);
}

test('every study points at a registration and a frozen event file that exist', () => {
  for (const study of EVENT_STUDIES) {
    const registration = JSON.parse(readFileSync(join(ROOT, study.hypothesesFile), 'utf8'));
    assert.equal(registration.version, study.id, `${study.id}: registration version mismatch`);
    assert.ok(directions(study.frozenFile).length > 0, `${study.id}: frozen file is empty`);
  }
});

test('the counted events match the frozen files the studies actually ran on', () => {
  // The guard that matters: if an event set is re-frozen or a study added,
  // this fails rather than letting the home page keep printing an old total.
  for (const study of EVENT_STUDIES) {
    const registration = JSON.parse(readFileSync(join(ROOT, study.hypothesesFile), 'utf8'));
    const arm = registration.event_filter.direction;
    assert.ok(arm, `${study.id}: registration declares no direction to select on`);
    const rows = directions(study.frozenFile);
    assert.equal(
      rows.filter((d) => d === arm).length,
      study.events,
      `${study.id}: treatment arm count drifted`,
    );
    if (study.controlEvents > 0) {
      const control = rows.filter((d) => d !== arm).length;
      assert.equal(control, study.controlEvents, `${study.id}: control arm count drifted`);
    }
  }
});

test('the totals the home page prints are the sum of the studies', () => {
  assert.equal(POLICY_EVENTS_STUDIED, 34);
  assert.equal(POLICY_CONTROL_EVENTS, 25);
  assert.equal(POLICY_EVENTS_STUDIED, EVENT_STUDIES.reduce((n, s) => n + s.events, 0));
});
