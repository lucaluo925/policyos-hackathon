/**
 * PolicyOS seed — migrates the pre-V3 curated dataset into the real DB.
 *
 * What this does:
 *   - Upserts the 15 countries from src/lib/data/countries.ts
 *   - Seeds the full submetric table from src/lib/data/metrics.ts
 *   - Computes and upserts domain scores from those submetrics
 *   - Upserts the curated policies from src/lib/data/policies.ts, each
 *     with a v1 PolicyVersion marked `seeded_data`
 *   - Upserts the Canada immigration monitored source (the only real
 *     pipeline source for V3)
 *
 * Safe to run repeatedly — every operation is an upsert keyed on a stable
 * natural identifier.
 */

import { PrismaClient } from '@prisma/client';
import type {
  Domain,
  LifecycleStatus,
  VerificationConfidence,
  VerificationMethod,
} from '@prisma/client';

// We import directly from the curated data files. TS will transpile these
// via ts-node / tsx.
import { countries } from '../src/lib/data/countries';
import { policies } from '../src/lib/data/policies';
import { countryMetrics } from '../src/lib/data/metrics';
import {
  CLIMATE_SUBMETRICS,
  IMMIGRATION_SUBMETRICS,
  TRADE_SUBMETRICS,
  METHODOLOGY_VERSION,
} from '../src/lib/scoring/weights';

const prisma = new PrismaClient();

// Map the legacy numeric metrics (all 0-100 already) onto the new submetric keys.
// Where a legacy metric isn't a direct match, we pick the closest signal and
// default the remainder to 50 (neutral). This is intentional: inventing
// submetric values would be dishonest; neutral-defaulting preserves the
// integrity of the scoring methodology.
function mapClimate(m: { climate: Record<string, number> }): Record<string, number> {
  const c = m.climate;
  return {
    emissions_target_ambition: c.climateActionAlignment ?? 50,
    carbon_pricing_or_equivalent: c.carbonPolicyStrength ?? 50,
    renewable_support_strength: c.climateActionAlignment ?? 50,
    fossil_fuel_constraint_strength: c.carbonPolicyStrength ?? 50,
    implementation_mechanism_strength: 50,
    adaptation_resilience_planning: 50,
    international_commitment_alignment: c.climateActionAlignment ?? 50,
  };
}

function mapImmigration(m: { immigration: Record<string, number> }): Record<string, number> {
  const i = m.immigration;
  return {
    skilled_migration_accessibility: i.immigrationOpenness ?? 50,
    permanent_residency_path_clarity: 50,
    student_to_work_transition: 50,
    family_reunification_openness: 50,
    asylum_humanitarian_openness: 50,
    processing_transparency_predictability: 50,
    employer_dependency_restriction_penalty: 100 - (i.borderControlIntensity ?? 50),
  };
}

function mapTrade(m: { trade: Record<string, number> }): Record<string, number> {
  const t = m.trade;
  return {
    tariff_openness: t.tradeOpennessIndex ?? 50,
    fta_network_strength: t.tradeOpennessIndex ?? 50,
    foreign_investment_openness: 50,
    export_control_restrictiveness_penalty: t.tradeProtectionIndex ?? 50,
    domestic_protectionism_penalty: t.tradeProtectionIndex ?? 50,
    customs_efficiency_predictability: 50,
    strategic_trade_intervention_balance: 50,
  };
}

function computeDomain(values: Record<string, number>, defs: typeof CLIMATE_SUBMETRICS): number {
  let sum = 0, total = 0;
  for (const d of defs) {
    const raw = values[d.key] ?? 50;
    sum += (d.penalty ? 100 - raw : raw) * d.weight;
    total += d.weight;
  }
  return Number((sum / total).toFixed(2));
}

// iso2 → iso3 mapping for the 15 countries in the curated dataset. Kept
// inline rather than as a separate file because it's both tiny and
// specific to this seed.
const ISO3: Record<string, string> = {
  US: 'USA', CN: 'CHN', DE: 'DEU', GB: 'GBR', FR: 'FRA', JP: 'JPN',
  IN: 'IND', BR: 'BRA', AU: 'AUS', CA: 'CAN', KR: 'KOR', SA: 'SAU',
  NG: 'NGA', SE: 'SWE', SG: 'SGP',
};

async function main() {
  console.log('▸ Seeding countries…');
  const countryByIso: Record<string, number> = {};
  for (const c of countries) {
    const iso3 = ISO3[c.iso] ?? c.iso.padEnd(3, 'X');
    const row = await prisma.country.upsert({
      where: { iso2: c.iso },
      create: {
        iso2: c.iso,
        iso3,
        name: c.name,
        region: c.region ?? null,
        population: c.population != null ? BigInt(c.population) : null,
        gdpMillionsUsd: c.gdp != null ? BigInt(c.gdp) : null,
        governmentType: c.governmentType ?? null,
        headOfState: c.headOfState ?? null,
        flagEmoji: c.flagEmoji ?? null,
      },
      update: {
        iso3,
        name: c.name,
        region: c.region ?? null,
        population: c.population != null ? BigInt(c.population) : null,
        gdpMillionsUsd: c.gdp != null ? BigInt(c.gdp) : null,
        governmentType: c.governmentType ?? null,
        headOfState: c.headOfState ?? null,
        flagEmoji: c.flagEmoji ?? null,
      },
    });
    countryByIso[c.iso] = row.id;
  }
  console.log(`  ✓ ${countries.length} countries`);

  console.log('▸ Seeding submetrics + domain scores…');
  let submetricRows = 0;
  for (const m of countryMetrics) {
    const countryId = countryByIso[m.iso];
    if (!countryId) continue;

    const domainMaps: { domain: Domain; values: Record<string, number>; defs: typeof CLIMATE_SUBMETRICS }[] = [
      { domain: 'climate', values: mapClimate(m), defs: CLIMATE_SUBMETRICS },
      { domain: 'immigration', values: mapImmigration(m), defs: IMMIGRATION_SUBMETRICS },
      { domain: 'trade', values: mapTrade(m), defs: TRADE_SUBMETRICS },
    ];

    for (const { domain, values, defs } of domainMaps) {
      for (const def of defs) {
        await prisma.scoreSubmetric.upsert({
          where: {
            countryId_domain_key: { countryId, domain, key: def.key },
          },
          create: {
            countryId,
            domain,
            key: def.key,
            score: values[def.key] ?? 50,
            weight: def.weight,
          },
          update: {
            score: values[def.key] ?? 50,
            weight: def.weight,
          },
        });
        submetricRows++;
      }
      const score = computeDomain(values, defs);
      await prisma.domainScore.upsert({
        where: { countryId_domain: { countryId, domain } },
        create: {
          countryId,
          domain,
          score,
          methodologyVersion: METHODOLOGY_VERSION,
          explanation: 'Seeded from curated 0-100 dataset.',
        },
        update: {
          score,
          methodologyVersion: METHODOLOGY_VERSION,
          explanation: 'Seeded from curated 0-100 dataset.',
          lastComputedAt: new Date(),
        },
      });
    }
  }
  console.log(`  ✓ ${submetricRows} submetric rows`);
  console.log(`  ✓ ${countryMetrics.length * 3} domain scores`);

  console.log('▸ Seeding policies + initial versions…');
  let policyRows = 0;
  for (const p of policies) {
    const countryId = countryByIso[p.countryIso];
    if (!countryId) continue;
    const slug = p.id; // reuse stable legacy id as slug
    const legacyStatus = (p.status ?? 'unknown') as string;
    const status: LifecycleStatus = (
      ['active', 'pending', 'amended', 'suspended', 'expired', 'repealed', 'superseded', 'unknown'] as const
    ).includes(legacyStatus as LifecycleStatus)
      ? (legacyStatus as LifecycleStatus)
      : 'unknown';

    const policy = await prisma.policy.upsert({
      where: { countryId_slug: { countryId, slug } },
      create: {
        id: p.id,
        countryId,
        domain: p.category as Domain,
        title: p.title,
        slug,
        summary: p.description,
        status,
        effectiveDate: p.effectiveDate ? new Date(p.effectiveDate) : null,
        officialSourceUrl: p.sourceUrl ?? null,
        sourceName: p.sourceName ?? null,
        verificationConfidence: 'medium' satisfies VerificationConfidence,
        verificationMethod: 'seeded_data' satisfies VerificationMethod,
        tags: p.tags ?? [],
        lastVerifiedAt: new Date(),
        nextReviewAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      update: {
        title: p.title,
        summary: p.description,
        status,
        effectiveDate: p.effectiveDate ? new Date(p.effectiveDate) : null,
        officialSourceUrl: p.sourceUrl ?? null,
        sourceName: p.sourceName ?? null,
        tags: p.tags ?? [],
      },
    });

    // Only create an initial version if none exists yet.
    const existingVersions = await prisma.policyVersion.count({ where: { policyId: policy.id } });
    if (existingVersions === 0) {
      const v = await prisma.policyVersion.create({
        data: {
          policyId: policy.id,
          versionNumber: 1,
          changeType: 'new_policy',
          summary: 'Seeded baseline version.',
          extractedText: p.description,
          sourceUrl: p.sourceUrl ?? null,
          confidence: 'medium',
          approvedState: status,
        },
      });
      await prisma.policy.update({
        where: { id: policy.id },
        data: { currentVersionId: v.id },
      });
    }
    policyRows++;
  }
  console.log(`  ✓ ${policyRows} policies`);

  console.log('▸ Seeding monitored sources (from pipeline coverage registry)…');
  const { PIPELINE_COVERAGE } = await import('../src/lib/pipeline/coverage');
  let seededSources = 0;
  for (const cov of PIPELINE_COVERAGE) {
    const cid = countryByIso[cov.countryIso];
    if (!cid) continue;
    // Key on pipelineKey (unique per pipeline) so URL changes reuse the row
    // rather than creating a dangling duplicate.
    const existing = await prisma.monitoredSource.findFirst({
      where: { pipelineKey: cov.pipelineKey },
    });
    if (existing) {
      await prisma.monitoredSource.update({
        where: { id: existing.id },
        data: {
          countryId: cid,
          sourceName: cov.sourceName,
          sourceUrl: cov.sourceUrl,
          sourceType: cov.sourceType,
          pipelineKey: cov.pipelineKey,
          checkFrequencyHours: cov.checkFrequencyHours,
          domain: cov.domain,
          trustPriority: cov.trustPriority,
          fallbackUrls: cov.fallbackUrls ?? [],
          active: true,
          // URL changed → reset lastHash so the next run captures a new baseline
          lastHash: existing.sourceUrl === cov.sourceUrl ? existing.lastHash : null,
        },
      });
    } else {
      await prisma.monitoredSource.create({
        data: {
          countryId: cid,
          domain: cov.domain,
          sourceName: cov.sourceName,
          sourceUrl: cov.sourceUrl,
          sourceType: cov.sourceType,
          pipelineKey: cov.pipelineKey,
          checkFrequencyHours: cov.checkFrequencyHours,
          trustPriority: cov.trustPriority,
          fallbackUrls: cov.fallbackUrls ?? [],
        },
      });
    }
    seededSources++;
  }
  console.log(`  ✓ ${seededSources} monitored sources from pipeline registry`);

  // News: the site shows only official feed items (see src/lib/feeds); nothing is seeded.

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
