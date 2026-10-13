/**
 * V5 verification snapshot — reports:
 *   - total pipelines + counts per domain
 *   - total policies, PolicyVersions grouped by extractionMethod / policyType
 *   - mapping rules seen (and top ones)
 *   - evidence-backed submetric count
 *   - feed items by source
 *   - recent score changes
 */
import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

async function main() {
  const [
    sources,
    policies,
    versions,
    runs,
    snapshots,
    submetricTotal,
    submetricEvidenced,
    scoreChanges,
    feedByProvenance,
    v5Versions,
  ] = await Promise.all([
    p.monitoredSource.findMany({ include: { country: true }, orderBy: { pipelineKey: 'asc' } }),
    p.policy.count(),
    p.policyVersion.count(),
    p.pipelineRun.count(),
    p.sourceSnapshot.count(),
    p.scoreSubmetric.count(),
    p.scoreSubmetric.count({ where: { evidenceBackedAt: { not: null } } }),
    p.scoreChangeLog.findMany({ orderBy: { createdAt: 'desc' }, take: 5, include: { country: true } }),
    p.newsArticle.groupBy({ by: ['provenance'], _count: true }),
    p.policyVersion.findMany({
      where: {
        OR: [
          { policyType: { not: null } },
          { mappingRules: { isEmpty: false } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        summary: true,
        policyType: true,
        guidanceType: true,
        extractionMethod: true,
        mappingRules: true,
        impactDirection: true,
        impactMagnitude: true,
        affectedSubmetrics: true,
        createdAt: true,
        policy: { select: { slug: true, country: { select: { iso2: true } }, domain: true } },
      },
    }),
  ]);

  const domainCount = { climate: 0, trade: 0, immigration: 0 } as Record<string, number>;
  for (const s of sources) domainCount[s.domain] = (domainCount[s.domain] ?? 0) + 1;

  console.log(JSON.stringify({
    pipelines: {
      total: sources.length,
      by_domain: domainCount,
      by_key: sources.map((s) => ({
        key: s.pipelineKey,
        country: s.country.iso2,
        domain: s.domain,
        lastHash: s.lastHash?.slice(0, 12) ?? null,
        lastCheckedAt: s.lastCheckedAt?.toISOString() ?? null,
      })),
    },
    counts: {
      policies,
      policy_versions: versions,
      pipeline_runs: runs,
      source_snapshots: snapshots,
    },
    scoring: {
      submetrics_total: submetricTotal,
      submetrics_evidence_backed: submetricEvidenced,
      evidence_pct: submetricTotal ? ((submetricEvidenced / submetricTotal) * 100).toFixed(2) + '%' : '0',
    },
    feed_by_provenance: feedByProvenance,
    recent_score_changes: scoreChanges.map((c) => ({
      country: c.country.iso2,
      domain: c.domain,
      prev: c.previousScore,
      new: c.newScore,
      delta: c.delta,
      explanation: c.explanation?.slice(0, 80),
    })),
    v5_versions_with_structured_fields: v5Versions.map((v) => ({
      id: v.id,
      country: v.policy.country.iso2,
      domain: v.policy.domain,
      policyType: v.policyType,
      guidanceType: v.guidanceType,
      extractionMethod: v.extractionMethod,
      mappingRules: v.mappingRules,
      impact: `${v.impactDirection}×${v.impactMagnitude}`,
      affected: v.affectedSubmetrics,
      summary: v.summary?.slice(0, 80),
    })),
  }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => p.$disconnect());
