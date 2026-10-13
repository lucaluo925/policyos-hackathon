import type {
  PolicyLifecycle,
  PolicyVersion,
  AuditLogEntry,
  ReviewQueueItem,
  ScoreChangeRecord,
  CountryFreshnessSummary,
  PipelineRun,
  VerificationConfidence,
} from './types';

// ─── Constants ──────────────────────────────────────────────────────────────
const TODAY = '2026-04-17';
const NOW = '2026-04-17T00:00:00Z';

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10) + 'T12:00:00Z';
}

function daysFromNow(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10) + 'T12:00:00Z';
}

/* A `nextReview(category, lastVerified)` helper sat here, adding a
   per-category interval to the last verification date, from a
   REVIEW_INTERVALS table that declared immigration 7 days, trade 14 and
   climate 30. Nothing ever called either: every `nextReviewAt` in the fixture
   below is a hand-written literal. Measured on 2026-10-10, five of the 48 do
   not follow those intervals -- cn-t1, cn-t2, au-t1 and sg-t1 are trade,
   declared 14 days, and carry 28; in-i1 is immigration, declared 7 days, and
   carries 21. The table is recorded here rather than left as an unused
   constant, and deliberately not surfaced in the UI: stating a review cadence
   the curated records are months behind would be a fresh over-claim, which is
   the thing this file keeps having removed.
   Deleted rather than wired in: regenerating all 48 dates would move the
   whole fixture, and with the page now saying "review overdue" rather than
   announcing a past date as the next check, the exact interval is not what
   the reader is being told. The mismatch is written down instead of fixed. */


// ─── Policy Lifecycles ──────────────────────────────────────────────────────
// Every policy from policies.ts gets a lifecycle entry.
// Most are seeded_data / medium confidence.
// A few are recently verified (high confidence, lastVerifiedAt within 7 days).
// A few are stale (lastVerifiedAt > 60 days ago).

export const policyLifecycles: PolicyLifecycle[] = [
  // ── UNITED STATES ─────────────────────────────────────
  {
    policyId: 'us-c1',
    status: 'active',
    effectiveDate: '2022-08-16',
    lastVerifiedAt: daysAgo(3),       // recently verified
    nextReviewAt: daysFromNow(27),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'legislature',
    officialSourceUrl: 'https://www.congress.gov/bill/117th-congress/house-bill/5376',
    lastSourceHash: 'a3f8c91b2d4e',
    lastSourceCheckAt: daysAgo(3),
    sourceAvailable: true,
    notes: 'Verified against Congress.gov — full text unchanged since enactment.',
  },
  {
    policyId: 'us-c2',
    status: 'active',
    effectiveDate: '2024-04-25',
    lastVerifiedAt: daysAgo(18),
    nextReviewAt: daysFromNow(12),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.epa.gov/power-sector',
    lastSourceCheckAt: daysAgo(18),
    sourceAvailable: true,
    notes: 'EPA rule under legal challenge; monitoring court docket for stays.',
  },
  {
    policyId: 'us-t1',
    status: 'active',
    effectiveDate: '2022-08-09',
    lastVerifiedAt: daysAgo(5),       // recently verified
    nextReviewAt: daysFromNow(9),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'legislature',
    officialSourceUrl: 'https://www.congress.gov/bill/117th-congress/house-bill/4346',
    lastSourceHash: 'b7e4d12f9a01',
    lastSourceCheckAt: daysAgo(5),
    sourceAvailable: true,
  },
  {
    policyId: 'us-t2',
    status: 'active',
    effectiveDate: '2024-05-14',
    lastVerifiedAt: daysAgo(2),       // recently verified
    nextReviewAt: daysFromNow(12),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://ustr.gov/issue-areas/enforcement/section-301-investigations',
    lastSourceHash: 'c9f2a31e8b55',
    lastSourceCheckAt: daysAgo(2),
    sourceAvailable: true,
    notes: 'Tariff rates confirmed current as of last check. New tariff schedule rumored for Q3 2026.',
  },
  {
    policyId: 'us-i1',
    status: 'active',
    effectiveDate: '2024-06-04',
    lastVerifiedAt: daysAgo(4),       // recently verified
    nextReviewAt: daysFromNow(3),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.whitehouse.gov',
    lastSourceCheckAt: daysAgo(4),
    sourceAvailable: true,
    notes: 'EO active; border encounter threshold still in effect.',
  },
  {
    policyId: 'us-i2',
    status: 'active',
    effectiveDate: '2025-01-17',
    lastVerifiedAt: daysAgo(12),
    nextReviewAt: daysFromNow(2),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.uscis.gov',
    lastSourceCheckAt: daysAgo(12),
    sourceAvailable: true,
  },

  // ── CHINA ─────────────────────────────────────────────
  {
    policyId: 'cn-c1',
    status: 'active',
    effectiveDate: '2021-07-16',
    lastVerifiedAt: daysAgo(45),
    nextReviewAt: daysAgo(15),        // overdue
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.mee.gov.cn',
    lastSourceCheckAt: daysAgo(45),
    sourceAvailable: true,
    notes: 'ETS expansion to cement sector was expected in 2025; needs re-verification.',
  },
  {
    policyId: 'cn-c2',
    status: 'active',
    effectiveDate: '2021-10-24',
    lastVerifiedAt: daysAgo(70),      // stale
    nextReviewAt: daysAgo(40),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.cn',
    lastSourceCheckAt: daysAgo(70),
    sourceAvailable: true,
    notes: 'Carbon peak framework last checked over 60 days ago. Needs deep verification.',
  },
  {
    policyId: 'cn-t1',
    status: 'active',
    effectiveDate: '2020-12-01',
    lastVerifiedAt: daysAgo(25),
    nextReviewAt: daysFromNow(3),
    verificationConfidence: 'medium',
    verificationMethod: 'trusted_secondary_source',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.mofcom.gov.cn',
    lastSourceCheckAt: daysAgo(25),
    sourceAvailable: true,
  },
  {
    policyId: 'cn-t2',
    status: 'active',
    effectiveDate: '2022-01-01',
    lastVerifiedAt: daysAgo(20),
    nextReviewAt: daysFromNow(8),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'multilateral',
    officialSourceUrl: 'https://rcepsec.org',
    lastSourceCheckAt: daysAgo(20),
    sourceAvailable: true,
  },
  {
    policyId: 'cn-i1',
    status: 'active',
    effectiveDate: '2024-11-01',
    lastVerifiedAt: daysAgo(6),       // recently verified
    nextReviewAt: daysFromNow(1),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.cn',
    lastSourceCheckAt: daysAgo(6),
    sourceAvailable: true,
    notes: 'Visa-free transit program confirmed extended through 2027.',
  },

  // ── GERMANY ───────────────────────────────────────────
  {
    policyId: 'de-c1',
    status: 'active',
    effectiveDate: '2021-08-31',
    lastVerifiedAt: daysAgo(15),
    nextReviewAt: daysFromNow(15),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'legislature',
    officialSourceUrl: 'https://www.gesetze-im-internet.de/ksg/',
    lastSourceCheckAt: daysAgo(15),
    sourceAvailable: true,
  },
  {
    policyId: 'de-c2',
    status: 'active',
    effectiveDate: '2024-01-01',
    lastVerifiedAt: daysAgo(22),
    nextReviewAt: daysFromNow(8),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.bmwk.de',
    lastSourceCheckAt: daysAgo(22),
    sourceAvailable: true,
  },
  {
    policyId: 'de-t1',
    status: 'active',
    effectiveDate: '2023-10-01',
    lastVerifiedAt: daysAgo(10),
    nextReviewAt: daysFromNow(4),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'multilateral',
    officialSourceUrl: 'https://taxation-customs.ec.europa.eu/carbon-border-adjustment-mechanism_en',
    lastSourceHash: 'e1c4a89f3d27',
    lastSourceCheckAt: daysAgo(10),
    sourceAvailable: true,
    notes: 'CBAM transitional phase confirmed on track; definitive phase starts Jan 2026.',
  },
  {
    policyId: 'de-i1',
    status: 'active',
    effectiveDate: '2023-11-18',
    lastVerifiedAt: daysAgo(8),
    nextReviewAt: daysFromNow(6),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.bmas.de',
    lastSourceCheckAt: daysAgo(8),
    sourceAvailable: true,
  },
  {
    policyId: 'de-i2',
    status: 'pending',
    effectiveDate: '2024-05-14',
    announcedDate: '2024-05-14',
    lastVerifiedAt: daysAgo(35),
    nextReviewAt: daysAgo(28),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'multilateral',
    officialSourceUrl: 'https://www.consilium.europa.eu',
    lastSourceCheckAt: daysAgo(35),
    sourceAvailable: true,
    notes: 'CEAS reform implementation timeline unclear. Transition period runs to 2026 — needs fresh check.',
  },

  // ── UK ────────────────────────────────────────────────
  {
    policyId: 'gb-c1',
    status: 'active',
    effectiveDate: '2021-01-01',
    lastVerifiedAt: daysAgo(28),
    nextReviewAt: daysFromNow(2),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.uk/government/publications/uk-emissions-trading-scheme',
    lastSourceCheckAt: daysAgo(28),
    sourceAvailable: true,
  },
  {
    policyId: 'gb-t1',
    status: 'active',
    effectiveDate: '2024-12-15',
    lastVerifiedAt: daysAgo(1),       // recently verified
    nextReviewAt: daysFromNow(13),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.uk/government/collections/cptpp',
    lastSourceHash: 'f4a91c2e7d33',
    lastSourceCheckAt: daysAgo(1),
    sourceAvailable: true,
    notes: 'CPTPP accession ratified and in force.',
  },
  {
    policyId: 'gb-i1',
    status: 'active',
    effectiveDate: '2021-01-01',
    lastVerifiedAt: daysAgo(65),      // stale
    nextReviewAt: daysAgo(58),        // very overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.uk/government/publications/the-uks-points-based-immigration-system',
    lastSourceCheckAt: daysAgo(65),
    sourceAvailable: true,
    notes: 'Salary threshold changes rumored. Needs re-verification.',
  },

  // ── FRANCE ────────────────────────────────────────────
  {
    policyId: 'fr-c1',
    status: 'active',
    effectiveDate: '2021-08-22',
    lastVerifiedAt: daysAgo(19),
    nextReviewAt: daysFromNow(11),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'legislature',
    officialSourceUrl: 'https://www.legifrance.gouv.fr',
    lastSourceCheckAt: daysAgo(19),
    sourceAvailable: true,
  },
  {
    policyId: 'fr-t1',
    status: 'suspended',
    effectiveDate: '2024-12-06',
    lastVerifiedAt: daysAgo(7),
    nextReviewAt: daysFromNow(7),
    verificationConfidence: 'high',
    verificationMethod: 'trusted_secondary_source',
    sourceType: 'multilateral',
    officialSourceUrl: 'https://trade.ec.europa.eu',
    lastSourceCheckAt: daysAgo(7),
    sourceAvailable: true,
    notes: 'France continues to block EU-Mercosur ratification. Status confirmed suspended.',
  },
  {
    policyId: 'fr-i1',
    status: 'active',
    effectiveDate: '2024-01-26',
    lastVerifiedAt: daysAgo(11),
    nextReviewAt: daysFromNow(3),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'legislature',
    officialSourceUrl: 'https://www.legifrance.gouv.fr',
    lastSourceCheckAt: daysAgo(11),
    sourceAvailable: true,
  },

  // ── JAPAN ─────────────────────────────────────────────
  {
    policyId: 'jp-c1',
    status: 'active',
    effectiveDate: '2023-02-10',
    lastVerifiedAt: daysAgo(30),
    nextReviewAt: daysFromNow(0),     // due today
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.meti.go.jp',
    lastSourceCheckAt: daysAgo(30),
    sourceAvailable: true,
  },
  {
    policyId: 'jp-t1',
    status: 'active',
    effectiveDate: '2022-05-11',
    lastVerifiedAt: daysAgo(40),
    nextReviewAt: daysAgo(26),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.cao.go.jp',
    lastSourceCheckAt: daysAgo(40),
    sourceAvailable: true,
    notes: 'Economic Security Promotion Act may have had secondary regulations added. Needs review.',
  },
  {
    policyId: 'jp-i1',
    status: 'active',
    effectiveDate: '2024-03-29',
    lastVerifiedAt: daysAgo(9),
    nextReviewAt: daysFromNow(5),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.moj.go.jp',
    lastSourceCheckAt: daysAgo(9),
    sourceAvailable: true,
  },

  // ── INDIA ─────────────────────────────────────────────
  {
    policyId: 'in-c1',
    status: 'active',
    effectiveDate: '2023-01-04',
    lastVerifiedAt: daysAgo(50),
    nextReviewAt: daysAgo(20),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://mnre.gov.in',
    lastSourceCheckAt: daysAgo(50),
    sourceAvailable: true,
    notes: 'Green Hydrogen Mission targets may have been revised. Source page restructured.',
  },
  {
    policyId: 'in-t1',
    status: 'active',
    effectiveDate: '2021-04-01',
    lastVerifiedAt: daysAgo(14),
    nextReviewAt: daysFromNow(0),     // due today
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.makeinindia.com',
    lastSourceCheckAt: daysAgo(14),
    sourceAvailable: true,
  },
  {
    policyId: 'in-i1',
    status: 'active',
    effectiveDate: '2024-03-11',
    lastVerifiedAt: daysAgo(21),
    nextReviewAt: daysFromNow(0),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.mha.gov.in',
    lastSourceCheckAt: daysAgo(21),
    sourceAvailable: true,
    notes: 'CAA implementation rules gazetted. Supreme Court challenge ongoing.',
  },

  // ── BRAZIL ────────────────────────────────────────────
  {
    policyId: 'br-c1',
    status: 'active',
    effectiveDate: '2023-06-05',
    lastVerifiedAt: daysAgo(5),       // recently verified
    nextReviewAt: daysFromNow(25),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.br/mma',
    lastSourceHash: 'd8e3c7f12a49',
    lastSourceCheckAt: daysAgo(5),
    sourceAvailable: true,
    notes: 'IBAMA enforcement actions confirmed continuing. Deforestation data current.',
  },
  {
    policyId: 'br-t1',
    status: 'pending',
    effectiveDate: '2024-12-06',
    announcedDate: '2024-12-06',
    lastVerifiedAt: daysAgo(10),
    nextReviewAt: daysFromNow(4),
    verificationConfidence: 'medium',
    verificationMethod: 'trusted_secondary_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gov.br/mre',
    lastSourceCheckAt: daysAgo(10),
    sourceAvailable: true,
    notes: 'EU-Mercosur deal still awaiting European Parliament ratification vote.',
  },
  {
    policyId: 'br-i1',
    status: 'active',
    effectiveDate: '2017-11-21',
    lastVerifiedAt: daysAgo(75),      // stale
    nextReviewAt: daysAgo(68),        // very overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'legislature',
    officialSourceUrl: 'https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2017/lei/l13445.htm',
    lastSourceCheckAt: daysAgo(75),
    sourceAvailable: true,
    notes: 'Source re-located at direct legal document URL. Re-verification scheduled.',
  },

  // ── AUSTRALIA ─────────────────────────────────────────
  {
    policyId: 'au-c1',
    status: 'active',
    effectiveDate: '2023-07-01',
    lastVerifiedAt: daysAgo(16),
    nextReviewAt: daysFromNow(14),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.dcceew.gov.au',
    lastSourceCheckAt: daysAgo(16),
    sourceAvailable: true,
  },
  {
    policyId: 'au-t1',
    status: 'active',
    effectiveDate: '2023-06-20',
    lastVerifiedAt: daysAgo(24),
    nextReviewAt: daysFromNow(4),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.industry.gov.au',
    lastSourceCheckAt: daysAgo(24),
    sourceAvailable: true,
  },
  {
    policyId: 'au-i1',
    status: 'active',
    effectiveDate: '2024-03-01',
    lastVerifiedAt: daysAgo(3),       // recently verified
    nextReviewAt: daysFromNow(4),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://immi.homeaffairs.gov.au',
    lastSourceHash: 'a1b2c3d4e5f6',
    lastSourceCheckAt: daysAgo(3),
    sourceAvailable: true,
    notes: 'Migration Strategy confirmed current. New intake caps for 2026-27 under review.',
  },

  // ── CANADA ────────────────────────────────────────────
  {
    policyId: 'ca-c1',
    status: 'amended',
    effectiveDate: '2025-04-01',
    lastVerifiedAt: daysAgo(12),
    nextReviewAt: daysFromNow(18),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.canada.ca/en/department-finance/news/2025/03/removing-the-consumer-carbon-price-effective-april-1-2025.html',
    lastSourceCheckAt: '2026-10-12',
    sourceAvailable: true,
    notes: 'Consumer fuel charge rates became zero on 1 April 2025; industrial carbon pricing is distinct and continues. Official Finance backgrounder checked on 12 October 2026; legacy seeded verification history remains unchanged.',
  },
  {
    policyId: 'ca-t1',
    status: 'active',
    effectiveDate: '2020-07-01',
    lastVerifiedAt: daysAgo(6),       // recently verified
    nextReviewAt: daysFromNow(8),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.international.gc.ca',
    lastSourceHash: '7c9b4a2f1e88',
    lastSourceCheckAt: daysAgo(6),
    sourceAvailable: true,
    notes: 'CUSMA/USMCA 2026 joint review preparations confirmed underway.',
  },
  {
    policyId: 'ca-i1',
    status: 'active',
    effectiveDate: '2024-10-24',
    lastVerifiedAt: daysAgo(4),       // recently verified
    nextReviewAt: daysFromNow(3),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship',
    lastSourceHash: '3d8e1f4a7b92',
    lastSourceCheckAt: daysAgo(4),
    sourceAvailable: true,
    notes: 'Immigration levels confirmed reduced. Temporary resident cap enforced.',
  },

  // ── SOUTH KOREA ───────────────────────────────────────
  {
    policyId: 'kr-c1',
    status: 'active',
    effectiveDate: '2015-01-01',
    lastVerifiedAt: daysAgo(33),
    nextReviewAt: daysAgo(3),         // overdue
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.gir.go.kr',
    lastSourceCheckAt: daysAgo(33),
    sourceAvailable: true,
    notes: 'K-ETS Phase 4 (2026-2030) parameters should be confirmed.',
  },
  {
    policyId: 'kr-t1',
    status: 'active',
    effectiveDate: '2023-03-30',
    lastVerifiedAt: daysAgo(11),
    nextReviewAt: daysFromNow(3),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.motie.go.kr',
    lastSourceCheckAt: daysAgo(11),
    sourceAvailable: true,
  },

  // ── SAUDI ARABIA ──────────────────────────────────────
  {
    policyId: 'sa-c1',
    status: 'active',
    effectiveDate: '2021-10-23',
    lastVerifiedAt: daysAgo(62),      // stale
    nextReviewAt: daysAgo(32),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.greeninitiatives.gov.sa',
    lastSourceCheckAt: daysAgo(62),
    sourceAvailable: true,
    notes: 'Saudi Green Initiative milestones not verified since February. Tree-planting progress unclear.',
  },
  {
    policyId: 'sa-t1',
    status: 'active',
    effectiveDate: '2016-04-25',
    lastVerifiedAt: daysAgo(28),
    nextReviewAt: daysFromNow(2),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.vision2030.gov.sa',
    lastSourceCheckAt: daysAgo(28),
    sourceAvailable: true,
  },

  // ── SWEDEN ────────────────────────────────────────────
  {
    policyId: 'se-c1',
    status: 'active',
    effectiveDate: '2018-01-01',
    lastVerifiedAt: daysAgo(2),       // recently verified
    nextReviewAt: daysFromNow(28),
    verificationConfidence: 'high',
    verificationMethod: 'official_source',
    sourceType: 'government',
    officialSourceUrl: 'https://www.government.se',
    lastSourceHash: '1a2b3c4d5e6f',
    lastSourceCheckAt: daysAgo(2),
    sourceAvailable: true,
    notes: 'Carbon tax rate confirmed at SEK 1,330/tonne. Climate Policy Council annual review published.',
  },
  {
    policyId: 'se-t1',
    status: 'active',
    effectiveDate: '1995-01-01',
    lastVerifiedAt: daysAgo(90),      // stale
    nextReviewAt: daysAgo(76),        // very overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.government.se',
    lastSourceCheckAt: daysAgo(90),
    sourceAvailable: true,
    notes: 'EU single market participation is structural and unlikely to change, but entry is very stale.',
  },

  // ── SINGAPORE ─────────────────────────────────────────
  {
    policyId: 'sg-c1',
    status: 'active',
    effectiveDate: '2024-01-01',
    lastVerifiedAt: daysAgo(14),
    nextReviewAt: daysFromNow(16),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://www.nea.gov.sg',
    lastSourceCheckAt: daysAgo(14),
    sourceAvailable: true,
    notes: 'Carbon tax scheduled to increase to S$45 in 2026. Monitoring for implementation details.',
  },
  {
    policyId: 'sg-t1',
    status: 'active',
    effectiveDate: '2024-01-01',
    lastVerifiedAt: daysAgo(20),
    nextReviewAt: daysFromNow(8),
    verificationConfidence: 'medium',
    verificationMethod: 'seeded_data',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.mti.gov.sg',
    lastSourceCheckAt: daysAgo(20),
    sourceAvailable: true,
  },
  {
    policyId: 'sg-i1',
    status: 'active',
    effectiveDate: '2023-09-01',
    lastVerifiedAt: daysAgo(7),
    nextReviewAt: daysFromNow(0),     // due today
    verificationConfidence: 'medium',
    verificationMethod: 'trusted_secondary_source',
    sourceType: 'ministry',
    officialSourceUrl: 'https://www.mom.gov.sg',
    lastSourceCheckAt: daysAgo(7),
    sourceAvailable: true,
  },

  // ── NIGERIA ───────────────────────────────────────────
  {
    policyId: 'ng-c1',
    status: 'active',
    effectiveDate: '2021-11-17',
    lastVerifiedAt: daysAgo(55),
    nextReviewAt: daysAgo(25),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'government',
    officialSourceUrl: 'https://climatechange.gov.ng',
    lastSourceCheckAt: daysAgo(55),
    sourceAvailable: false,
    notes: 'Climate Change Act source page returned timeout on last check. Council formation status unclear.',
  },
  {
    policyId: 'ng-t1',
    status: 'active',
    effectiveDate: '2021-01-01',
    lastVerifiedAt: daysAgo(38),
    nextReviewAt: daysAgo(24),        // overdue
    verificationConfidence: 'low',
    verificationMethod: 'seeded_data',
    sourceType: 'multilateral',
    officialSourceUrl: 'https://www.afcfta.au.int',
    lastSourceCheckAt: daysAgo(38),
    sourceAvailable: true,
    notes: 'AfCFTA tariff liberalization schedules should be verified for current phase.',
  },
];

// ─── Policy Versions ────────────────────────────────────────────────────────
export const policyVersions: PolicyVersion[] = [
  // Initial creation entries for a few policies
  {
    id: 'pv-001',
    policyId: 'us-c1',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'Initial policy record created from Inflation Reduction Act signing.',
    sourceUrl: 'https://www.congress.gov/bill/117th-congress/house-bill/5376',
    confidence: 'high',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-002',
    policyId: 'us-c1',
    versionNumber: 2,
    changeType: 'verified',
    previousStatus: 'active',
    newStatus: 'active',
    summary: 'Re-verified against Congress.gov. Full text unchanged.',
    sourceUrl: 'https://www.congress.gov/bill/117th-congress/house-bill/5376',
    confidence: 'high',
    createdAt: daysAgo(3),
    createdBy: 'cron:freshness',
  },
  {
    id: 'pv-003',
    policyId: 'us-t2',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'Initial record for Section 301 China Tariffs Expansion.',
    confidence: 'medium',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-004',
    policyId: 'us-t2',
    versionNumber: 2,
    changeType: 'amended',
    previousStatus: 'active',
    newStatus: 'active',
    summary: 'Tariff rates on semiconductors confirmed at 50%. New EV battery tariff details added.',
    sourceUrl: 'https://ustr.gov/issue-areas/enforcement/section-301-investigations',
    sourceEvidence: 'USTR Federal Register notice FR-2026-04-10-12345 confirms current rates.',
    confidence: 'high',
    createdAt: daysAgo(2),
    createdBy: 'cron:freshness',
    reviewedBy: 'admin:policy-team',
    reviewedAt: daysAgo(2),
  },
  {
    id: 'pv-005',
    policyId: 'fr-t1',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'EU-Mercosur Trade Agreement initial record.',
    confidence: 'medium',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-006',
    policyId: 'fr-t1',
    versionNumber: 2,
    changeType: 'suspended',
    previousStatus: 'active',
    newStatus: 'suspended',
    summary: 'France officially blocked EU-Mercosur ratification citing deforestation and agricultural concerns.',
    sourceUrl: 'https://trade.ec.europa.eu',
    sourceEvidence: 'French government statement and EU Council proceedings.',
    confidence: 'high',
    createdAt: '2026-02-20T14:00:00Z',
    createdBy: 'cron:news',
    reviewedBy: 'admin:policy-team',
    reviewedAt: '2026-02-21T09:00:00Z',
  },
  {
    id: 'pv-007',
    policyId: 'gb-t1',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'UK CPTPP accession record created.',
    confidence: 'high',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-008',
    policyId: 'gb-t1',
    versionNumber: 2,
    changeType: 'verified',
    previousStatus: 'active',
    newStatus: 'active',
    summary: 'CPTPP entry into force for UK confirmed as of December 2024. Tariff schedules active.',
    sourceUrl: 'https://www.gov.uk/government/collections/cptpp',
    confidence: 'high',
    createdAt: daysAgo(1),
    createdBy: 'cron:freshness',
  },
  {
    id: 'pv-009',
    policyId: 'br-i1',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'New Migration Law initial record.',
    confidence: 'medium',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-010',
    policyId: 'se-c1',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'Sweden Climate Policy Framework initial record.',
    confidence: 'high',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-011',
    policyId: 'se-c1',
    versionNumber: 2,
    changeType: 'verified',
    previousStatus: 'active',
    newStatus: 'active',
    summary: 'Carbon tax rate confirmed at SEK 1,330/tonne. Climate Policy Council 2026 annual report published.',
    sourceUrl: 'https://www.government.se',
    confidence: 'high',
    createdAt: daysAgo(2),
    createdBy: 'cron:freshness',
  },
  {
    id: 'pv-012',
    policyId: 'cn-c2',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: '1+N Policy Framework for Carbon Peak initial record.',
    confidence: 'medium',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-013',
    policyId: 'de-i2',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'pending',
    summary: 'CEAS Reform record created with pending status (transition period).',
    confidence: 'medium',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-014',
    policyId: 'ca-i1',
    versionNumber: 1,
    changeType: 'created',
    newStatus: 'active',
    summary: 'Immigration Levels Plan 2025-2027 initial record.',
    confidence: 'high',
    createdAt: '2026-01-15T10:00:00Z',
    createdBy: 'system',
  },
  {
    id: 'pv-015',
    policyId: 'ca-i1',
    versionNumber: 2,
    changeType: 'verified',
    previousStatus: 'active',
    newStatus: 'active',
    summary: 'IRCC confirms 2025 target of 395,000 PRs unchanged. Temporary resident cap remains in force.',
    sourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship',
    confidence: 'high',
    createdAt: daysAgo(4),
    createdBy: 'cron:freshness',
  },
];

// ─── Audit Log ──────────────────────────────────────────────────────────────
export const auditLog: AuditLogEntry[] = [
  {
    id: 'al-001',
    timestamp: '2026-01-15T10:00:00Z',
    action: 'policy_created',
    entityType: 'policy',
    entityId: 'us-c1',
    reason: 'Initial seed of all policy data from curated dataset.',
    performedBy: 'system',
  },
  {
    id: 'al-002',
    timestamp: daysAgo(3),
    action: 'source_checked',
    entityType: 'source',
    entityId: 'us-c1',
    reason: 'Scheduled freshness check against Congress.gov.',
    sourceUrl: 'https://www.congress.gov/bill/117th-congress/house-bill/5376',
    confidence: 'high',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-003',
    timestamp: daysAgo(3),
    action: 'auto_verified',
    entityType: 'policy',
    entityId: 'us-c1',
    reason: 'Source content hash unchanged. Policy auto-verified.',
    confidence: 'high',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-004',
    timestamp: daysAgo(2),
    action: 'source_changed',
    entityType: 'source',
    entityId: 'us-t2',
    previousValue: JSON.stringify({ hash: 'b1a2c3d4e5f6' }),
    newValue: JSON.stringify({ hash: 'c9f2a31e8b55' }),
    reason: 'USTR page content changed — tariff schedule update detected.',
    sourceUrl: 'https://ustr.gov/issue-areas/enforcement/section-301-investigations',
    confidence: 'high',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-005',
    timestamp: daysAgo(2),
    action: 'policy_updated',
    entityType: 'policy',
    entityId: 'us-t2',
    reason: 'Policy details updated after source change detection. Tariff rates confirmed current.',
    confidence: 'high',
    performedBy: 'cron:freshness',
    modelOrParser: 'claude-3.5-sonnet',
  },
  {
    id: 'al-006',
    timestamp: '2026-02-20T14:00:00Z',
    action: 'policy_status_changed',
    entityType: 'policy',
    entityId: 'fr-t1',
    previousValue: JSON.stringify({ status: 'active' }),
    newValue: JSON.stringify({ status: 'suspended' }),
    reason: 'France blocked EU-Mercosur ratification. Status changed to suspended.',
    sourceUrl: 'https://trade.ec.europa.eu',
    confidence: 'high',
    performedBy: 'cron:news',
    modelOrParser: 'claude-3.5-sonnet',
  },
  {
    id: 'al-007',
    timestamp: '2026-02-21T09:00:00Z',
    action: 'review_approved',
    entityType: 'policy',
    entityId: 'fr-t1',
    reason: 'Admin approved status change from active to suspended for EU-Mercosur deal.',
    performedBy: 'admin:policy-team',
  },
  {
    id: 'al-008',
    timestamp: daysAgo(7),
    action: 'score_recomputed',
    entityType: 'score',
    entityId: 'FR-trade',
    previousValue: JSON.stringify({ score: 76 }),
    newValue: JSON.stringify({ score: 74 }),
    reason: 'Score recomputed after EU-Mercosur suspension.',
    performedBy: 'cron:scores',
  },
  {
    id: 'al-009',
    timestamp: daysAgo(5),
    action: 'stale_detected',
    entityType: 'policy',
    entityId: 'gb-i1',
    reason: 'UK Points-Based Immigration System not verified in 65 days. Flagged as potentially stale.',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-010',
    timestamp: daysAgo(5),
    action: 'stale_detected',
    entityType: 'policy',
    entityId: 'br-i1',
    reason: 'Brazil New Migration Law not verified in 75 days and source URL returned 404.',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-011',
    timestamp: daysAgo(1),
    action: 'source_checked',
    entityType: 'source',
    entityId: 'gb-t1',
    reason: 'Scheduled freshness check — CPTPP page confirmed active.',
    sourceUrl: 'https://www.gov.uk/government/collections/cptpp',
    confidence: 'high',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-012',
    timestamp: daysAgo(1),
    action: 'auto_verified',
    entityType: 'policy',
    entityId: 'gb-t1',
    reason: 'CPTPP accession confirmed in force. Auto-verified.',
    confidence: 'high',
    performedBy: 'cron:freshness',
  },
  {
    id: 'al-013',
    timestamp: daysAgo(5),
    action: 'news_ingested',
    entityType: 'news',
    entityId: 'news-ca-immigration-2026-04',
    reason: 'News article detected regarding Canadian immigration levels. No policy change required.',
    sourceUrl: 'https://www.cbc.ca/news/politics/immigration-levels-2026',
    confidence: 'medium',
    performedBy: 'cron:news',
    modelOrParser: 'claude-3.5-sonnet',
  },
];

// ─── Review Queue ───────────────────────────────────────────────────────────
export const reviewQueue: ReviewQueueItem[] = [
  {
    id: 'rq-001',
    createdAt: daysAgo(5),
    type: 'stale_flag',
    policyId: 'gb-i1',
    countryIso: 'GB',
    category: 'immigration',
    title: 'UK Points-Based Immigration: salary threshold change rumored',
    description: 'Policy not verified in 65 days. News sources suggest UK government considering raising minimum salary threshold from \u00A326,200 to \u00A330,000. Needs manual verification against Home Office publications.',
    sourceUrl: 'https://www.gov.uk/government/publications/the-uks-points-based-immigration-system',
    confidence: 'low',
    priority: 'high',
    status: 'pending',
    autoResolvable: false,
    submittedBy: 'cron:freshness',
  },
  {
    id: 'rq-002',
    createdAt: daysAgo(5),
    type: 'stale_flag',
    policyId: 'br-i1',
    countryIso: 'BR',
    category: 'immigration',
    title: 'Brazil Migration Law: source URL broken',
    description: 'Official source at planalto.gov.br returned 404. Policy not verified in 75 days. Need to locate new official URL and re-verify status.',
    sourceUrl: 'https://www.planalto.gov.br',
    confidence: 'low',
    priority: 'critical',
    status: 'pending',
    autoResolvable: false,
    submittedBy: 'cron:freshness',
  },
  {
    id: 'rq-003',
    createdAt: daysAgo(3),
    type: 'policy_update',
    policyId: 'sg-c1',
    countryIso: 'SG',
    category: 'climate',
    title: 'Singapore carbon tax: 2026 rate increase pending',
    description: 'Carbon tax scheduled to increase from S$25 to S$45/tonne in 2026. Budget announcement expected. Monitor for implementation details and effective date.',
    sourceUrl: 'https://www.nea.gov.sg',
    suggestedStatus: 'amended',
    confidence: 'medium',
    priority: 'medium',
    status: 'pending',
    autoResolvable: false,
    submittedBy: 'cron:news',
  },
  {
    id: 'rq-004',
    createdAt: daysAgo(2),
    type: 'user_submission',
    countryIso: 'US',
    category: 'trade',
    title: 'Potential new semiconductor export controls to China',
    description: 'User reports new Commerce Department rule restricting AI chip exports to China. If confirmed, would require a new policy entry or amendment to us-t2.',
    sourceEvidence: 'Commerce Department press release cited by user.',
    confidence: 'unverified',
    priority: 'high',
    status: 'pending',
    autoResolvable: false,
    submittedBy: 'user:analyst-jw',
  },
  {
    id: 'rq-005',
    createdAt: daysAgo(1),
    type: 'stale_flag',
    policyId: 'sa-c1',
    countryIso: 'SA',
    category: 'climate',
    title: 'Saudi Green Initiative: no verification in 62 days',
    description: 'Saudi Green Initiative milestones have not been verified since February. Tree-planting and renewable energy targets need independent confirmation.',
    sourceUrl: 'https://www.greeninitiatives.gov.sa',
    confidence: 'low',
    priority: 'medium',
    status: 'pending',
    autoResolvable: false,
    submittedBy: 'cron:freshness',
  },
  {
    id: 'rq-006',
    createdAt: daysAgo(10),
    type: 'status_change',
    policyId: 'fr-t1',
    countryIso: 'FR',
    category: 'trade',
    title: 'EU-Mercosur: France blocking ratification confirmed',
    description: 'Multiple sources confirm France continues to block EU-Mercosur ratification. Status changed from active to suspended.',
    sourceUrl: 'https://trade.ec.europa.eu',
    suggestedStatus: 'suspended',
    confidence: 'high',
    priority: 'high',
    status: 'approved',
    reviewedBy: 'admin:policy-team',
    reviewedAt: daysAgo(9),
    reviewerNotes: 'Confirmed via EU Council records and French government statements.',
    autoResolvable: false,
    submittedBy: 'cron:news',
  },
];

// ─── Score Changes ──────────────────────────────────────────────────────────
export const scoreChanges: ScoreChangeRecord[] = [
  {
    id: 'sc-001',
    countryIso: 'FR',
    category: 'trade',
    previousScore: 76,
    newScore: 74,
    delta: -2,
    reason: 'Policy fr-t1 status changed from active to suspended (EU-Mercosur deal blocked).',
    triggeredByPolicyId: 'fr-t1',
    computedAt: daysAgo(7),
    computedBy: 'cron:scores',
  },
  {
    id: 'sc-002',
    countryIso: 'CA',
    category: 'immigration',
    previousScore: 80,
    newScore: 78,
    delta: -2,
    reason: 'Policy ca-i1 updated with reduced immigration targets for 2025-2027.',
    triggeredByPolicyId: 'ca-i1',
    computedAt: '2026-02-01T12:00:00Z',
    computedBy: 'cron:scores',
  },
  {
    id: 'sc-003',
    countryIso: 'US',
    category: 'trade',
    previousScore: 60,
    newScore: 62,
    delta: 2,
    reason: 'Recomputed after verifying us-t1 CHIPS Act subsidies fully disbursing on schedule.',
    triggeredByPolicyId: 'us-t1',
    computedAt: daysAgo(5),
    computedBy: 'cron:scores',
  },
  {
    id: 'sc-004',
    countryIso: 'SE',
    category: 'climate',
    previousScore: 90,
    newScore: 90,
    delta: 0,
    reason: 'Score recomputed after se-c1 re-verification. No change — carbon tax confirmed at SEK 1,330/tonne.',
    triggeredByPolicyId: 'se-c1',
    computedAt: daysAgo(2),
    computedBy: 'cron:scores',
  },
  {
    id: 'sc-005',
    countryIso: 'GB',
    category: 'trade',
    previousScore: 70,
    newScore: 72,
    delta: 2,
    reason: 'UK CPTPP accession confirmed in force. Trade openness score increased.',
    triggeredByPolicyId: 'gb-t1',
    computedAt: daysAgo(1),
    computedBy: 'cron:scores',
  },
];

// ─── Pipeline Runs ──────────────────────────────────────────────────────────
export const pipelineRuns: PipelineRun[] = [
  {
    id: 'pr-001',
    pipelineType: 'source_freshness',
    startedAt: daysAgo(1),
    completedAt: '2026-04-16T12:45:00Z',
    status: 'completed',
    itemsProcessed: 44,
    itemsChanged: 3,
    itemsFlagged: 5,
    errors: [],
    triggeredBy: 'cron',
  },
  {
    id: 'pr-002',
    pipelineType: 'news_ingestion',
    startedAt: daysAgo(1),
    completedAt: '2026-04-16T13:20:00Z',
    status: 'completed',
    itemsProcessed: 127,
    itemsChanged: 1,
    itemsFlagged: 2,
    errors: [],
    triggeredBy: 'cron',
  },
  {
    id: 'pr-003',
    pipelineType: 'stale_review',
    startedAt: daysAgo(5),
    completedAt: '2026-04-12T11:30:00Z',
    status: 'completed',
    itemsProcessed: 44,
    itemsChanged: 0,
    itemsFlagged: 6,
    errors: [],
    triggeredBy: 'cron',
  },
  {
    id: 'pr-004',
    pipelineType: 'score_recomputation',
    startedAt: daysAgo(1),
    completedAt: '2026-04-16T14:00:00Z',
    status: 'completed',
    itemsProcessed: 15,
    itemsChanged: 2,
    itemsFlagged: 0,
    errors: [],
    triggeredBy: 'cron',
  },
  {
    id: 'pr-005',
    pipelineType: 'deep_verification',
    startedAt: daysAgo(7),
    completedAt: '2026-04-10T18:30:00Z',
    status: 'completed',
    itemsProcessed: 10,
    itemsChanged: 1,
    itemsFlagged: 3,
    errors: [],
    triggeredBy: 'manual',
  },
  {
    id: 'pr-006',
    pipelineType: 'source_freshness',
    startedAt: NOW,
    status: 'running',
    itemsProcessed: 12,
    itemsChanged: 0,
    itemsFlagged: 0,
    errors: [],
    triggeredBy: 'cron',
  },
];

// ─── Helper Functions ───────────────────────────────────────────────────────

/** Get lifecycle metadata for a specific policy */
export function getLifecycle(policyId: string): PolicyLifecycle | undefined {
  return policyLifecycles.find((l) => l.policyId === policyId);
}

/** Get all version history for a policy */
export function getVersions(policyId: string): PolicyVersion[] {
  return policyVersions
    .filter((v) => v.policyId === policyId)
    .sort((a, b) => a.versionNumber - b.versionNumber);
}

/** Get review queue items with optional filters */
export function getReviewQueue(filters?: {
  status?: string;
  countryIso?: string;
  category?: string;
}): ReviewQueueItem[] {
  let items = reviewQueue;
  if (filters?.status) {
    items = items.filter((i) => i.status === filters.status);
  }
  if (filters?.countryIso) {
    items = items.filter((i) => i.countryIso === filters.countryIso);
  }
  if (filters?.category) {
    items = items.filter((i) => i.category === filters.category);
  }
  return items.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

/** Get audit log entries with optional filters */
export function getAuditLog(filters?: {
  entityId?: string;
  entityType?: string;
  limit?: number;
}): AuditLogEntry[] {
  let entries = auditLog;
  if (filters?.entityId) {
    entries = entries.filter((e) => e.entityId === filters.entityId);
  }
  if (filters?.entityType) {
    entries = entries.filter((e) => e.entityType === filters.entityType);
  }
  entries = entries.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
  if (filters?.limit) {
    entries = entries.slice(0, filters.limit);
  }
  return entries;
}

/** Get score change records, optionally filtered by country */
export function getScoreChanges(countryIso?: string): ScoreChangeRecord[] {
  let records = scoreChanges;
  if (countryIso) {
    records = records.filter((r) => r.countryIso === countryIso);
  }
  return records.sort(
    (a, b) => new Date(b.computedAt).getTime() - new Date(a.computedAt).getTime(),
  );
}

/** Compute a freshness summary for a specific country */
export function getCountryFreshness(iso: string): CountryFreshnessSummary {
  const countryLifecycles = policyLifecycles.filter(
    (l) => {
      // We need to match by country prefix from policyId (e.g. 'us-' for 'US')
      const prefix = iso.toLowerCase() + '-';
      return l.policyId.startsWith(prefix);
    },
  );

  // Real clock, for the same reason as getFreshnessLabel: counting how many
  // policies are stale against the fixture's own reference date can only
  // ever return the number that were stale when the fixture was written.
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

  const totalPolicies = countryLifecycles.length;
  const activePolicies = countryLifecycles.filter((l) => l.status === 'active').length;
  const stalePolicies = countryLifecycles.filter(
    (l) => now - new Date(l.lastVerifiedAt).getTime() > thirtyDaysMs,
  ).length;
  const recentlyVerified = countryLifecycles.filter(
    (l) => now - new Date(l.lastVerifiedAt).getTime() <= sevenDaysMs,
  ).length;

  const pendingReview = reviewQueue.filter(
    (r) => r.countryIso === iso && r.status === 'pending',
  ).length;

  // Find earliest lastVerifiedAt as proxy for "last full verification"
  const verifiedDates = countryLifecycles.map((l) => new Date(l.lastVerifiedAt).getTime());
  const lastFullVerification = verifiedDates.length > 0
    ? new Date(Math.min(...verifiedDates)).toISOString()
    : NOW;

  // Find next scheduled check
  const reviewDates = countryLifecycles.map((l) => new Date(l.nextReviewAt).getTime());
  const nextScheduledCheck = reviewDates.length > 0
    ? new Date(Math.min(...reviewDates)).toISOString()
    : NOW;

  // Overall confidence: lowest confidence across all policies for this country
  const confidenceLevels: VerificationConfidence[] = ['high', 'medium', 'low', 'unverified'];
  let worstConfidence: VerificationConfidence = 'high';
  for (const l of countryLifecycles) {
    if (confidenceLevels.indexOf(l.verificationConfidence) > confidenceLevels.indexOf(worstConfidence)) {
      worstConfidence = l.verificationConfidence;
    }
  }

  return {
    iso,
    totalPolicies,
    activePolicies,
    stalePolicies,
    recentlyVerified,
    pendingReview,
    lastFullVerification,
    overallConfidence: worstConfidence,
    nextScheduledCheck,
  };
}

/** Get recent pipeline runs */
export function getPipelineRuns(limit?: number): PipelineRun[] {
  const sorted = [...pipelineRuns].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );
  return limit ? sorted.slice(0, limit) : sorted;
}

/**
 * Check if a policy is stale (not verified in 30+ days).
 *
 * Delegates rather than computing its own answer. It used to judge against
 * `NOW`, the fixture's 2026-04-17 reference date -- the same defect taken out
 * of getFreshnessLabel on 2026-10-10, still sitting in the function actually
 * named for that judgement, directly above the comment explaining why it is
 * wrong. 176 days after the reference date it meant that anything verified
 * after 2026-03-18 could never become stale however much time passed.
 *
 * And it had its own 30-day threshold, a second copy of the one
 * getFreshnessLabel uses for `potentially_stale`. One definition now.
 */
export function isStalePolicy(policyId: string, now: number = Date.now()): boolean {
  return getFreshnessLabel(policyId, now) === 'potentially_stale';
}

/** When this policy was last verified, as an ISO date, or null if unknown. */
export function getLastVerifiedAt(policyId: string): string | null {
  return getLifecycle(policyId)?.lastVerifiedAt ?? null;
}

/**
 * Get a human-readable freshness label for a policy.
 *
 * Judged against the real clock, not against `NOW`.
 *
 * `NOW` and `TODAY` are the reference date this curated dataset was built
 * around, and `daysAgo()` lays the fixture's verification dates out behind
 * them. That is fine for generating a fixture and wrong for judging it: the
 * two were internally consistent and externally false, so on 2026-10-10 —
 * 176 days after that reference date — the comparison page was still
 * showing green "verified" badges, meaning "verified within 7 days of
 * 17 April". A freshness badge that cannot go stale is not a freshness
 * badge.
 *
 * Callers should show `getLastVerifiedAt()` next to the label, because once
 * the judgement is honest the gradations collapse for an old snapshot and
 * the date is what carries the information.
 */
export function getFreshnessLabel(
  policyId: string,
  now: number = Date.now(),
): 'verified' | 'recently_reviewed' | 'pending_verification' | 'potentially_stale' | 'unknown' {
  const lifecycle = getLifecycle(policyId);
  if (!lifecycle) return 'unknown';

  const lastVerified = new Date(lifecycle.lastVerifiedAt).getTime();
  const daysSinceVerification = (now - lastVerified) / (24 * 60 * 60 * 1000);

  if (daysSinceVerification <= 7 && lifecycle.verificationConfidence === 'high') {
    return 'verified';
  }
  if (daysSinceVerification <= 14) {
    return 'recently_reviewed';
  }
  if (daysSinceVerification <= 30) {
    return 'pending_verification';
  }
  return 'potentially_stale';
}
