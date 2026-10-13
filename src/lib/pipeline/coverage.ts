/**
 * Pipeline coverage registry — per-pipeline metadata surfaced to the UI.
 *
 * Single source of truth for country / domain / sourceUrl / scheduling.
 * Used by:
 *   - the seed script to upsert MonitoredSource rows
 *   - the admin UI coverage matrix
 *   - the cron planner
 *
 * V5 expansion: adds trade (EU, Japan, Korea) and climate (Germany, UK,
 * France) pipelines, plus India immigration and Brazil migration.
 */

import type { Domain, SourceType } from '@prisma/client';

export interface PipelineCoverage {
  pipelineKey: string;
  label: string;
  countryIso: string;
  domain: Domain;
  sourceUrl: string;
  /** V7: alternate source URLs the pipeline will try when the primary fails. */
  fallbackUrls?: string[];
  sourceName: string;
  sourceType: SourceType;
  trustPriority: number;
  /** How often the pipeline should be checked — used by getOverdueSources. */
  checkFrequencyHours: number;
  /** Honest schedule label for UI. */
  schedule: 'daily-cron' | 'manual';
}

export const PIPELINE_COVERAGE: PipelineCoverage[] = [
  // ── V4: original five ──────────────────────────────────────────────────
  {
    pipelineKey: 'canada-immigration',
    label: 'Canada IRCC — Policies Index',
    countryIso: 'CA',
    domain: 'immigration',
    // Verified 2026-10-10: the policies page answers 200 with 24,395 bytes and
    // zero feed entries, and this pipeline parses feeds only -- it has no HTML
    // fallback -- so from that URL it can produce nothing at all. The
    // Government of Canada news API, which the feed registry already reads for
    // the same department, returns 20 usable entries in its Atom form.
    sourceUrl:
      'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofcitizenshipandimmigration&type=newsreleases&sort=publishedDate&orderBy=desc&pick=20&format=atom',
    fallbackUrls: [
      'https://www.canada.ca/en/immigration-refugees-citizenship/corporate/mandate/policies-operational-instructions-agreements.html',
      'https://www.canada.ca/en/immigration-refugees-citizenship/news.html',
    ],
    sourceName: 'IRCC — Policies and Operational Instructions',
    sourceType: 'ministry',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'us-immigration',
    label: 'USCIS — Policy Manual Updates (deep)',
    countryIso: 'US',
    domain: 'immigration',
    sourceUrl: 'https://www.uscis.gov/policy-manual/updates',
    fallbackUrls: [
      'https://www.dhs.gov/news-releases',
    ],
    sourceName: 'USCIS Policy Manual — Updates',
    sourceType: 'government',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'uk-immigration',
    label: 'GOV.UK — Immigration Rules',
    countryIso: 'GB',
    domain: 'immigration',
    sourceUrl: 'https://www.gov.uk/guidance/immigration-rules',
    sourceName: 'GOV.UK — Immigration Rules',
    sourceType: 'government',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'singapore-climate',
    label: 'MSE Singapore — Climate Policies',
    countryIso: 'SG',
    domain: 'climate',
    sourceUrl: 'https://www.mse.gov.sg/policies',
    sourceName: 'Ministry of Sustainability and the Environment — Policies',
    sourceType: 'ministry',
    trustPriority: 2,
    checkFrequencyHours: 48,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'australia-immigration',
    label: 'Home Affairs AU — Visa News Archive',
    countryIso: 'AU',
    domain: 'immigration',
    sourceUrl: 'https://immi.homeaffairs.gov.au/news-media/archive',
    sourceName: 'Department of Home Affairs — News & Media Archive',
    sourceType: 'government',
    trustPriority: 2,
    checkFrequencyHours: 48,
    schedule: 'daily-cron',
  },

  // ── V5: trade (new domain) ─────────────────────────────────────────────
  {
    pipelineKey: 'eu-trade',
    label: 'European Commission — Trade news',
    countryIso: 'FR',
    domain: 'trade',
    sourceUrl: 'https://policy.trade.ec.europa.eu/news_en',
    // V7 fallbacks: EC press corner (broader, often mirrors DG Trade news),
    // and the EU newsroom RSS gateway.
    fallbackUrls: [
      'https://ec.europa.eu/commission/presscorner/home/en',
      'https://policy.trade.ec.europa.eu/news_en?page=1',
    ],
    sourceName: 'European Commission — DG Trade news',
    sourceType: 'multilateral',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'japan-trade',
    label: 'METI Japan — Press releases',
    countryIso: 'JP',
    domain: 'trade',
    // V7: try the lighter English news list first; /english/press/index.html
    // is slow and was timing out from Vercel egress.
    sourceUrl: 'https://www.meti.go.jp/english/news/index.html',
    fallbackUrls: [
      'https://www.meti.go.jp/english/press/index.html',
    ],
    sourceName: 'METI — English news/press index',
    sourceType: 'ministry',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'korea-trade',
    label: 'MOTIE Korea — Announcements',
    countryIso: 'KR',
    domain: 'trade',
    // V7: stable MOTIE English page.
    sourceUrl: 'https://www.motie.go.kr/eng/article/ATCLd7a1ec60-7dda-4a5d-9dfc-9ea0c9f20ead/list.do?clCode=&pCode=',
    fallbackUrls: [
      'https://english.motie.go.kr/en/main.jsp',
      'https://english.motie.go.kr/en/pc/pressreleases/bbs/bbsList.do?bbs_cd_n=2',
    ],
    sourceName: 'MOTIE — Press releases (English)',
    sourceType: 'ministry',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },

  // ── V5: climate (expanded domain) ──────────────────────────────────────
  {
    pipelineKey: 'germany-climate',
    label: 'BMUV Germany — Climate press releases',
    countryIso: 'DE',
    domain: 'climate',
    // Verified 2026-10-10: the former URL answers 200 but is the ministry's
    // English landing page -- 167,550 bytes, zero feed entries, and the only
    // anchors on it are topic navigation. bmuv.de now redirects to
    // bundesumweltministerium.de (BMUKN), whose English press-release feed
    // returns 20 usable entries. Landing page kept as a fallback only.
    sourceUrl: 'https://www.bundesumweltministerium.de/en/meldungen.rss',
    fallbackUrls: ['https://www.bundesumweltministerium.de/en/'],
    sourceName: 'BMUV — Federal Ministry for the Environment',
    sourceType: 'ministry',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'uk-climate',
    label: 'GOV.UK — DESNZ Net Zero announcements',
    countryIso: 'GB',
    domain: 'climate',
    // Verified 2026-10-10: the HTML search page answers 200 with 449,102
    // bytes and no feed entries, so the pipeline could only reach it through
    // its HTML fallback, which yields 10 items. The .atom form of the same
    // search returns 20 usable entries. HTML page kept as a fallback.
    sourceUrl:
      'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=department-for-energy-security-and-net-zero',
    fallbackUrls: [
      'https://www.gov.uk/search/news-and-communications?organisations%5B%5D=department-for-energy-security-and-net-zero',
    ],
    sourceName: 'GOV.UK — Department for Energy Security & Net Zero',
    sourceType: 'government',
    trustPriority: 1,
    checkFrequencyHours: 24,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'france-climate',
    label: 'Ministère Transition Écologique — Press room',
    countryIso: 'FR',
    domain: 'climate',
    sourceUrl: 'https://www.ecologie.gouv.fr/presse',
    sourceName: 'France — Ministère de la Transition Écologique',
    sourceType: 'ministry',
    trustPriority: 2,
    checkFrequencyHours: 48,
    schedule: 'daily-cron',
  },

  // ── V5: extras ────────────────────────────────────────────────────────
  {
    pipelineKey: 'india-immigration',
    label: 'India MHA — Immigration Visa section',
    countryIso: 'IN',
    domain: 'immigration',
    sourceUrl: 'https://www.mha.gov.in/en/divisionofmha/foreigners-division',
    sourceName: 'Ministry of Home Affairs — Foreigners Division',
    sourceType: 'ministry',
    trustPriority: 2,
    checkFrequencyHours: 48,
    schedule: 'daily-cron',
  },
  {
    pipelineKey: 'brazil-migration',
    label: 'Brazil MJSP — Migração notícias',
    countryIso: 'BR',
    domain: 'immigration',
    sourceUrl: 'https://www.gov.br/mj/pt-br/assuntos/seus-direitos/migracoes',
    sourceName: 'Ministério da Justiça e Segurança Pública — Migrações',
    sourceType: 'ministry',
    trustPriority: 2,
    checkFrequencyHours: 48,
    schedule: 'daily-cron',
  },
];

export function getCoverage(pipelineKey: string): PipelineCoverage | undefined {
  return PIPELINE_COVERAGE.find((c) => c.pipelineKey === pipelineKey);
}

/** Domain-by-country coverage matrix, useful for the admin + compare UIs. */
export function coverageMatrix() {
  const matrix: Record<string, Record<Domain, string[]>> = {};
  for (const c of PIPELINE_COVERAGE) {
    if (!matrix[c.countryIso]) {
      matrix[c.countryIso] = { climate: [], trade: [], immigration: [] };
    }
    matrix[c.countryIso][c.domain].push(c.pipelineKey);
  }
  return matrix;
}
