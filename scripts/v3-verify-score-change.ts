/**
 * V3 verification helper — forces one real ScoreChangeLog row by:
 *   1. picking an existing Canada immigration policy
 *   2. appending a PolicyVersion with impactDirection=positive, magnitude=3,
 *      affecting two submetrics
 *   3. calling recomputeScoresAfterPolicyChange() → applies the nudge and
 *      writes the change log if the aggregate moves.
 *
 * Run with:
 *   source .env.local && npx tsx scripts/v3-verify-score-change.ts
 */

import { PrismaClient } from '@prisma/client';
import { createPolicyVersion } from '../src/lib/db/repositories/policies';
import { recomputeScoresAfterPolicyChange } from '../src/lib/scoring/engine';

const prisma = new PrismaClient();

async function main() {
  const policy = await prisma.policy.findFirst({
    where: {
      domain: 'immigration',
      country: { iso2: 'CA' },
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!policy) throw new Error('No Canada immigration policy found — did you seed?');

  console.log(`▸ Target policy: ${policy.id} — ${policy.title}`);

  const version = await createPolicyVersion({
    policyId: policy.id,
    changeType: 'amendment',
    summary: 'V3 verification: simulated positive amendment for score-change-log proof.',
    sourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html',
    confidence: 'high',
    approvedState: 'active',
    impactDirection: 'positive',
    impactMagnitude: 3,
    affectedSubmetrics: [
      'skilled_migration_accessibility',
      'processing_transparency_predictability',
    ],
    scoreExplanation: 'Verification nudge: +3 magnitude on two submetrics.',
    setAsCurrent: true,
  });
  console.log(`▸ PolicyVersion created: ${version.id} (v${version.versionNumber})`);

  const log = await recomputeScoresAfterPolicyChange({
    policyId: policy.id,
    triggeringVersionId: version.id,
    explanation: 'V3 verification: positive amendment applied to 2 submetrics; domain recomputed.',
  });

  if (!log) {
    console.log(
      '▸ No ScoreChangeLog row written (delta was smaller than 0.005). This can happen if submetrics were already clamped at 100.',
    );
  } else {
    console.log(
      `✅ ScoreChangeLog created: ${log.id} — ${log.previousScore.toFixed(2)} → ${log.newScore.toFixed(2)} (Δ ${log.delta.toFixed(2)})`,
    );
  }
}

main()
  .catch((e) => {
    console.error('❌ Failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
