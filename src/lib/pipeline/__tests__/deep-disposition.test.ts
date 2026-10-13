import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deepItemDisposition, isProposalItem } from '../helpers/deep-disposition';

test('a proposal does not become the current active version', () => {
  const d = deepItemDisposition({ guidanceType: 'proposal' });
  assert.equal(d.changeType, 'proposal_only');
  assert.equal(d.setAsCurrent, false);
  assert.equal(d.approvedState, null);
});

test('a proposal may not move country scores', () => {
  assert.equal(deepItemDisposition({ guidanceType: 'proposal' }).mayMoveScores, false);
  assert.equal(deepItemDisposition({ policyType: 'proposal' }).mayMoveScores, false);
});

test('either field can type an item as a proposal', () => {
  assert.equal(isProposalItem({ guidanceType: 'proposal' }), true);
  assert.equal(isProposalItem({ policyType: 'proposal' }), true);
  assert.equal(isProposalItem({ guidanceType: 'news', policyType: 'proposal' }), true);
});

test('operational guidance still becomes current, as before', () => {
  const d = deepItemDisposition({ guidanceType: 'operational_guidance' });
  assert.equal(d.changeType, 'guidance_update');
  assert.equal(d.setAsCurrent, true);
  assert.equal(d.approvedState, 'active');
  assert.equal(d.mayMoveScores, true);
});

test('a news item is unchanged by this rule -- deliberately', () => {
  // Whether a press release should become the current version of a policy is
  // a product question, not a bug with one right answer, and most live
  // records come in this way. Pinned so a later change is a decision rather
  // than a drift.
  const d = deepItemDisposition({ guidanceType: 'news' });
  assert.equal(d.changeType, 'guidance_update');
  assert.equal(d.setAsCurrent, true);
  assert.equal(d.mayMoveScores, true);
});

test('an untyped item keeps the previous behaviour', () => {
  const d = deepItemDisposition({});
  assert.equal(d.changeType, 'guidance_update');
  assert.equal(d.setAsCurrent, true);
});

test('a text-detected proposal is guarded too', () => {
  // processDeepItem passes the resolved policyType, so detectPolicyType's
  // verdict reaches here. A row must not read policyType "proposal" while
  // also being the policy's current active state.
  const d = deepItemDisposition({ guidanceType: 'news', policyType: 'proposal' });
  assert.equal(d.changeType, 'proposal_only');
  assert.equal(d.setAsCurrent, false);
  assert.equal(d.mayMoveScores, false);
});

test('law and regulation are in force, so they still apply', () => {
  for (const policyType of ['law', 'regulation', 'guidance'] as const) {
    const d = deepItemDisposition({ policyType });
    assert.equal(d.setAsCurrent, true, policyType);
    assert.equal(d.mayMoveScores, true, policyType);
  }
});
