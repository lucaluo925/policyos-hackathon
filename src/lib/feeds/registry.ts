/**
 * Feed ingestion registry.
 *
 * Each entry defines a real, public government feed we ingest into the
 * `news_articles` table with `ingestionType='rss_feed'` and a truthful
 * `provenance` label ('official_feed'). We intentionally pick Atom/RSS
 * feeds published by the source governments themselves — not a news
 * aggregator — so the UI can honestly label items as "live official
 * updates" rather than "real-time".
 *
 * Adding a new feed: append an entry with { key, url, source, domain,
 * countryIso, provenance }. Ingestion is driven by `/api/feeds/ingest`.
 */

import type { Domain } from '@prisma/client';
import { classifyDomain } from './classify';

export interface FeedRegistryEntry {
  key: string;
  label: string;
  url: string;
  source: string; // display source name
  /**
   * Fixed topic for single-topic feeds, or 'auto' for general government
   * newsrooms: each item's topic is decided from its title by
   * `classifyDomain`, and items matching no topic are dropped.
   */
  domain: Domain | 'auto';
  /** ISO2 of the country (or countries, for EU-level feeds) the items apply to. */
  countryIso: string | string[];
  /** Language the titles are published in (ISO 639-1). Defaults to 'en'. */
  lang?: string;
  provenance: 'official_feed';
  /** Titles matching this are routine paperwork, not policy news — skipped at ingest. */
  excludeTitle?: RegExp;
  /** If set, only titles matching this are kept (for feeds that mix topics). */
  includeTitle?: RegExp;
}

/**
 * Decide whether an item from `feedKey` is shown and under which topic.
 * Returns null when the item should be dropped. Used at ingest time and again
 * at read time, so already-stored rows obey later filter changes.
 */
export function resolveFeedItem(feedKey: string | null | undefined, title: string, storedDomain: Domain): Domain | null {
  const f = FEED_REGISTRY.find((x) => x.key === feedKey);
  if (!f) return storedDomain;
  if (f.excludeTitle?.test(title)) return null;
  if (f.includeTitle && !f.includeTitle.test(title)) return null;
  if (f.domain === 'auto') return classifyDomain(title);
  return f.domain;
}

export function keepFeedTitle(feedKey: string | null | undefined, title: string): boolean {
  return resolveFeedItem(feedKey, title, 'climate') !== null;
}

export function feedCountries(f: FeedRegistryEntry): string[] {
  return Array.isArray(f.countryIso) ? f.countryIso : [f.countryIso];
}

export function feedLang(feedKey: string | null | undefined): string {
  return FEED_REGISTRY.find((x) => x.key === feedKey)?.lang ?? 'en';
}

export const FEED_REGISTRY: FeedRegistryEntry[] = [
  {
    key: 'govuk-ukvi-announcements',
    label: 'GOV.UK — UK Visas & Immigration announcements',
    url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=uk-visas-and-immigration&order=updated-newest',
    source: 'GOV.UK',
    domain: 'immigration',
    countryIso: 'GB',
    provenance: 'official_feed',
  },
  {
    key: 'govuk-home-office-announcements',
    label: 'GOV.UK — Home Office announcements',
    url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=home-office&order=updated-newest',
    source: 'GOV.UK',
    // The Home Office also covers policing and crime; keep only topic matches.
    domain: 'auto',
    countryIso: 'GB',
    provenance: 'official_feed',
  },
  // V5: DESNZ + DG Trade + USCIS
  {
    key: 'govuk-desnz-announcements',
    label: 'GOV.UK — DESNZ announcements',
    url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=department-for-energy-security-and-net-zero&order=updated-newest',
    source: 'GOV.UK',
    domain: 'climate',
    countryIso: 'GB',
    provenance: 'official_feed',
  },
  // USCIS RSS: attempted but Newsroom feed URL returns 404; USCIS policy
  // manual updates feed schema varies. Left out of the live registry to
  // avoid persistent 404s; re-add once a stable URL is confirmed.

  // V13: official US federal documents (Federal Register RSS) and Canada's
  // government news API. All verified to return entries on 2026-09-22.
  {
    key: 'fr-epa-significant-rules',
    label: 'Federal Register — EPA significant final rules',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions[agencies][]=environmental-protection-agency&conditions[type][]=RULE&conditions[significant]=1&order=newest',
    source: 'Federal Register (EPA)',
    domain: 'climate',
    countryIso: 'US',
    provenance: 'official_feed',
  },
  {
    key: 'fr-ustr',
    label: 'Federal Register — Office of the US Trade Representative',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions[agencies][]=trade-representative-office-of-united-states&order=newest',
    source: 'Federal Register (USTR)',
    domain: 'trade',
    countryIso: 'US',
    provenance: 'official_feed',
    excludeTitle: /information collection|meeting of|advisory committee/i,
  },
  {
    key: 'fr-bis-rules',
    label: 'Federal Register — Bureau of Industry and Security rules',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions[agencies][]=industry-and-security-bureau&conditions[type][]=RULE&order=newest',
    source: 'Federal Register (BIS)',
    domain: 'trade',
    countryIso: 'US',
    provenance: 'official_feed',
  },
  {
    key: 'fr-uscis',
    label: 'Federal Register — USCIS',
    url: 'https://www.federalregister.gov/api/v1/documents.rss?conditions[agencies][]=u-s-citizenship-and-immigration-services&order=newest',
    source: 'Federal Register (USCIS)',
    domain: 'immigration',
    countryIso: 'US',
    provenance: 'official_feed',
    excludeTitle: /information collection|correction$/i,
  },
  {
    key: 'canada-ircc-news',
    label: 'Canada News Centre — Immigration, Refugees and Citizenship Canada',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofcitizenshipandimmigration&type=newsreleases&sort=publishedDate&orderBy=desc&pick=25&format=atom',
    source: 'Government of Canada (IRCC)',
    domain: 'immigration',
    countryIso: 'CA',
    provenance: 'official_feed',
    // The News Centre API returns some non-immigration releases for this department.
    includeTitle: /immigra|refugee|asylum|citizenship|visa|permanent resid|newcomer|francophone|work permit|study permit|international student|temporary resident|border|IRCC/i,
  },
  // V14: more countries. Each URL verified on 2026-09-22 to return current
  // entries. General newsrooms use domain 'auto' (keyword topic filter).
  {
    key: 'govuk-dbt-announcements',
    label: 'GOV.UK — Department for Business and Trade announcements',
    url: 'https://www.gov.uk/search/news-and-communications.atom?organisations%5B%5D=department-for-business-and-trade&order=updated-newest',
    source: 'GOV.UK (DBT)',
    domain: 'auto',
    countryIso: 'GB',
    provenance: 'official_feed',
  },
  {
    key: 'canada-eccc-news',
    label: 'Canada News Centre — Environment and Climate Change Canada',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentoftheenvironment&sort=publishedDate&orderBy=desc&pick=25&format=atom',
    source: 'Government of Canada (ECCC)',
    domain: 'auto',
    countryIso: 'CA',
    provenance: 'official_feed',
  },
  {
    key: 'canada-gac-news',
    label: 'Canada News Centre — Global Affairs Canada (trade)',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=departmentofforeignaffairstradeanddevelopment&type=newsreleases&sort=publishedDate&orderBy=desc&pick=25&format=atom',
    source: 'Government of Canada (Global Affairs)',
    domain: 'trade',
    countryIso: 'CA',
    provenance: 'official_feed',
    includeTitle: /\btrade\b|tariff|export|import|free trade|economic partnership|investment|sanction|supply chain/i,
  },
  {
    key: 'canada-cbsa-news',
    label: 'Canada News Centre — Canada Border Services Agency',
    url: 'https://api.io.canada.ca/io-server/gc/news/en/v2?dept=canadaborderservicesagency&sort=publishedDate&orderBy=desc&pick=25&format=atom',
    source: 'Government of Canada (CBSA)',
    domain: 'auto',
    countryIso: 'CA',
    provenance: 'official_feed',
    // Drug and weapon seizures are enforcement news, not trade policy.
    excludeTitle: /seiz|narcotic|cocaine|methamphetamine|fentanyl|firearm|cannabis/i,
  },
  {
    key: 'de-bundesregierung',
    label: 'Bundesregierung — Aktuelles',
    url: 'https://www.bundesregierung.de/service/rss/breg-de/1151242/feed.xml',
    source: 'Bundesregierung',
    domain: 'auto',
    countryIso: 'DE',
    lang: 'de',
    provenance: 'official_feed',
  },
  {
    key: 'de-bmukn',
    label: 'Bundesumweltministerium (BMUKN) — Meldungen',
    url: 'https://www.bundesumweltministerium.de/meldungen.rss',
    source: 'Bundesumweltministerium',
    domain: 'auto',
    countryIso: 'DE',
    lang: 'de',
    provenance: 'official_feed',
  },
  {
    key: 'eu-commission-press',
    label: 'European Commission — press releases (applies to EU members)',
    url: 'https://ec.europa.eu/commission/presscorner/api/rss?language=en',
    source: 'European Commission',
    domain: 'auto',
    // Trade, climate and migration rules are set at EU level for these members.
    countryIso: ['DE', 'FR', 'SE'],
    provenance: 'official_feed',
  },
  {
    key: 'se-migrationsverket',
    label: 'Migrationsverket — nyheter',
    url: 'https://www.migrationsverket.se/rss',
    source: 'Migrationsverket',
    domain: 'immigration',
    countryIso: 'SE',
    lang: 'sv',
    provenance: 'official_feed',
    // Staff appointments and agency branding are not policy news.
    excludeTitle: /direktör|presschef|logotyp|almedalsveckan|ny generaldirektör|webbplats/i,
  },
  {
    key: 'au-pm-media',
    label: 'Prime Minister of Australia — media',
    url: 'https://www.pm.gov.au/rss.xml',
    source: 'Prime Minister of Australia',
    domain: 'auto',
    countryIso: 'AU',
    provenance: 'official_feed',
  },
  {
    key: 'br-agencia-gov',
    label: 'Agência Gov — Governo Federal',
    url: 'https://agenciagov.ebc.com.br/rss.xml',
    source: 'Agência Gov',
    domain: 'auto',
    countryIso: 'BR',
    lang: 'pt',
    provenance: 'official_feed',
  },
  {
    key: 'br-mdic-noticias',
    label: 'Ministério do Desenvolvimento, Indústria, Comércio e Serviços — notícias',
    url: 'https://www.gov.br/mdic/pt-br/assuntos/noticias/RSS',
    source: 'MDIC',
    domain: 'auto',
    countryIso: 'BR',
    lang: 'pt',
    provenance: 'official_feed',
  },
  {
    key: 'jp-mof-news',
    label: 'Ministry of Finance Japan — news releases (customs & foreign trade only)',
    url: 'https://www.mof.go.jp/english/news.rss',
    source: 'Ministry of Finance Japan',
    domain: 'trade',
    countryIso: 'JP',
    provenance: 'official_feed',
    // Mostly bond auctions and statistics; keep only trade / FX-control policy.
    includeTitle: /tariff|customs|FEFTA|foreign exchange and foreign trade|economic partnership|trade agreement|export|import|sanction|anti-dumping/i,
    excludeTitle: /statistics|auction|JGB|treasury discount/i,
  },
  {
    key: 'ng-statehouse',
    label: 'State House Nigeria — press releases',
    url: 'https://statehouse.gov.ng/feed/',
    source: 'State House Nigeria',
    domain: 'auto',
    countryIso: 'NG',
    provenance: 'official_feed',
  },
];

export function getFeed(key: string): FeedRegistryEntry | undefined {
  return FEED_REGISTRY.find((f) => f.key === key);
}
