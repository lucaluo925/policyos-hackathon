/**
 * V6 inspection: look at the deep PolicyVersions created by the last runs,
 * numeric_values populated, mapping rules fired, score changes applied.
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const [
    runs,
    versionsWithNumeric,
    versionsByPolicyType,
    highConfVersions,
    failureBreakdown,
    evidenceBacked,
    totalSubmetrics,
    recentScoreChanges,
  ] = await Promise.all([
    p.pipelineRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        id: true,
        pipelineKey: true,
        status: true,
        changeType: true,
        failureType: true,
        retryCount: true,
        deepItemsFetched: true,
        deepItemsApplied: true,
        itemsFlagged: true,
        summary: true,
        startedAt: true,
      },
    }),
    p.policyVersion.findMany({
      where: { numericValues: { not: Prisma.JsonNull } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        summary: true,
        policyType: true,
        guidanceType: true,
        extractionConfidence: true,
        numericValues: true,
        mappingRules: true,
        affectedSubmetrics: true,
        impactDirection: true,
        impactMagnitude: true,
        policy: { select: { country: { select: { iso2: true } }, domain: true, slug: true } },
      },
    }),
    p.policyVersion.groupBy({
      by: ['policyType'],
      _count: true,
      where: { policyType: { not: null } },
    }),
    p.policyVersion.count({
      where: {
        extractionConfidence: 'high',
        numericValues: { not: Prisma.JsonNull },
      },
    }),
    p.pipelineRun.groupBy({ by: ['failureType'], _count: true, where: { status: 'failed' } }),
    p.scoreSubmetric.count({ where: { evidenceBackedAt: { not: null } } }),
    p.scoreSubmetric.count(),
    p.scoreChangeLog.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { country: { select: { iso2: true } } },
    }),
  ]);
  console.log(JSON.stringify({
    recent_runs: runs.map((r) => ({
      pipeline: r.pipelineKey,
      status: r.status,
      deepFetched: r.deepItemsFetched,
      deepApplied: r.deepItemsApplied,
      retries: r.retryCount,
      failure: r.failureType,
      summary: r.summary?.slice(0, 80),
    })),
    evidence: {
      submetrics_total: totalSubmetrics,
      submetrics_evidence_backed: evidenceBacked,
      pct: ((evidenceBacked / totalSubmetrics) * 100).toFixed(2) + '%',
    },
    high_confidence_versions: highConfVersions,
    policy_types: versionsByPolicyType,
    failures: failureBreakdown,
    versions_with_numeric_values: versionsWithNumeric.slice(0, 5).map((v) => ({
      country: v.policy.country.iso2,
      domain: v.policy.domain,
      policyType: v.policyType,
      extractionConfidence: v.extractionConfidence,
      numeric: v.numericValues,
      mappingRules: v.mappingRules,
      impact: `${v.impactDirection}×${v.impactMagnitude}`,
      affected: v.affectedSubmetrics,
      summary: (v.summary ?? '').slice(0, 80),
    })),
    recent_score_changes: recentScoreChanges.map((c) => ({
      country: c.country.iso2,
      domain: c.domain,
      prev: c.previousScore,
      new: c.newScore,
      delta: c.delta,
      explanation: (c.explanation ?? '').slice(0, 80),
    })),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());

// shim so the import works up top
import { Prisma } from '@prisma/client';
