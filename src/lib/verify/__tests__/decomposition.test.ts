import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preserveClaimYears, preserveDatedContractEligibility, preserveIndependentReferents, preserveScopeDateRelation } from '../decomposition';

const claim = "Australia's right to disconnect applied to employees of all employers, including small businesses, from 26 August 2024.";

test('a scope and its date cannot be verified as separately true fragments', () => {
  const split = [
    { id: 'a1', text: 'The right to disconnect applies to all employers.', searchQuery: 'Australia right disconnect employers' },
    { id: 'a2', text: 'Small businesses are included.', searchQuery: 'Australia right disconnect small businesses' },
    { id: 'a3', text: 'The right to disconnect took effect in 2024.', searchQuery: 'Australia right disconnect 2024' },
  ];
  assert.deepEqual(preserveScopeDateRelation(claim, split), [{ id: 'a1', text: claim, searchQuery: claim }]);
});

test('an intact scoped date and an ordinary year claim retain the model decomposition', () => {
  const intact = [{ id: 'a1', text: 'The right to disconnect covered small businesses from 26 August 2024.', searchQuery: 'small business right disconnect 2024' }];
  assert.equal(preserveScopeDateRelation(claim, intact), intact);
  const ordinary = [{ id: 'a1', text: 'The policy took effect in 2026.', searchQuery: 'policy 2026' }];
  assert.equal(preserveScopeDateRelation('The policy took effect in 2026.', ordinary), ordinary);
});

test('a future target year cannot disappear from a fully supported multi-year claim', () => {
  const full = "Singapore's carbon tax was S$25 in 2024 and 2025, rose to S$45 in 2026, and S$50–80 by 2030 was a target rather than a rate already in force.";
  const truncated = [
    { id: 'a1', text: 'The tax was S$25 in 2024.', searchQuery: 'Singapore tax 2024' },
    { id: 'a2', text: 'The tax was S$25 in 2025.', searchQuery: 'Singapore tax 2025' },
    { id: 'a3', text: 'The tax rose to S$45 in 2026.', searchQuery: 'Singapore carbon tax 2026 target 2030' },
  ];
  assert.deepEqual(preserveClaimYears(full, truncated), [{ id: 'a1', text: full, searchQuery: full }]);
  const intact = [
    { id: 'a1', text: 'The tax was S$25 in 2024 and 2025 and S$45 in 2026.', searchQuery: 'Singapore tax rates' },
    { id: 'a2', text: 'S$50–80 by 2030 remained a target.', searchQuery: 'Singapore 2030 carbon tax target' },
  ];
  assert.equal(preserveClaimYears(full, intact), intact);
  assert.equal(preserveClaimYears('The tax rate is S$45.', truncated), truncated);
});

test('a later such-applicants assertion cannot lose the earlier eligibility date', () => {
  const full = 'Canadian college graduates who applied for a study permit before 1 November 2024 are exempt from the PGWP field-of-study requirement when applying in 2026.';
  const fragments = [
    { id: 'a1', text: 'Canadian college graduates who applied for a study permit before 1 November 2024 are exempt.', searchQuery: 'Canada PGWP study permit 2024 exception' },
    { id: 'a2', text: 'Such graduates are exempt when applying in 2026.', searchQuery: 'Canada PGWP 2026 exemption' },
  ];
  assert.deepEqual(preserveIndependentReferents(full, fragments),
    [{ id: 'a1', text: full, searchQuery: full }]);
  const one = [fragments[0]];
  assert.equal(preserveIndependentReferents(full, one), one);
});

test('a dated-contract entitlement cannot become a general warehouse entitlement', () => {
  const full = 'Under the United Kingdom steel measure, steel imported under a contract entered into before 14 March 2026 and released from a warehouse in July 2026 can qualify for a transitional exemption.';
  const broadened = [
    { id: 'a1', text: 'Steel imported under a contract entered into before 14 March 2026 can qualify for an exemption.', searchQuery: 'UK steel contract exemption' },
    { id: 'a2', text: 'Steel released from a warehouse in July 2026 qualifies for the exemption.', searchQuery: 'UK steel warehouse exemption' },
  ];
  assert.deepEqual(preserveDatedContractEligibility(full, broadened),
    [{ id: 'a1', text: full, searchQuery: full }]);
  const intact = [{ ...broadened[1], text: 'Steel released from a warehouse in July 2026 under a contract entered into before 14 March 2026 qualifies for the exemption.' }];
  assert.equal(preserveDatedContractEligibility(full, intact), intact);
  assert.equal(preserveDatedContractEligibility('A warehouse exemption applies in July 2026.', broadened), broadened);
});
