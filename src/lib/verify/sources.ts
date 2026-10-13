/**
 * Is a cited URL on an official government or multilateral domain?
 *
 * This exists as a shared module on purpose. The first version of this test
 * lived inside the seeding script as `url.includes('.gov')`, which also
 * counted gov-watch.com, any path containing ".int" (say
 * `/report.integration`), and any third-party article whose URL merely
 * mentioned europa.eu. It inflated a reported metric before anyone noticed.
 * Matching is now done against the parsed HOSTNAME, as a suffix, in one place.
 * Do not reimplement it anywhere else.
 *
 * What this is NOT: a claim that an official source is correct, or that a
 * non-official one is wrong. It answers one narrow question — did this come
 * from a known government/multilateral domain or another publisher — a
 * distinction PolicyOS's evidence argument exposes, and which the
 * /verify page would otherwise leave invisible. An official government domain
 * does not establish that the publisher is the legal issuing body for a claim
 * or that its cited excerpt supports the verdict.
 */

const OFFICIAL_HOST_SUFFIXES = [
  // national government
  '.gov', '.gov.uk', '.gov.au', '.gov.sg', '.gov.in', '.gov.br', '.gov.za',
  '.gc.ca', '.canada.ca', '.go.jp', '.go.kr', '.bund.de', '.gouv.fr',
  '.gob.mx', '.gob.es', 'boe.es', '.gov.cn', '.gov.se', '.regeringen.se',
  // Swiss federal government and the newly integrated MY/NZ government sources.
  '.admin.ch', '.gov.my', '.gov.qa', '.govt.nz',
  '.gov.hk', '.gov.si', '.gov.ie', '.gov.ae', 'u.ae',
  // Additional country-government research domains, each checked against a
  // live ministry or agency site before enabling the map search action.
  '.gov.sa', '.go.ke', '.gov.ph', '.gov.ng',
  'irishimmigration.ie', 'regjeringen.no', 'skatteetaten.no',
  // BMF uses its own domain outside bund.de. Publisher verified in its legal
  // notice: https://www.bundesfinanzministerium.de/Content/DE/Impressum/impressum.html
  'bundesfinanzministerium.de',
  // EU and multilateral
  'europa.eu', 'wto.org', 'oecd.org', 'un.org', 'unfccc.int', 'imf.org',
  'worldbank.org', 'iea.org', 'wipo.int', 'ilo.org',
  '.int',
] as const;

export function isOfficialSource(rawUrl: string): boolean {
  let host: string;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return OFFICIAL_HOST_SUFFIXES.some(
    (suffix) => host === suffix.replace(/^\./, '') || host.endsWith(`.${suffix.replace(/^\./, '')}`),
  );
}

/** A narrow domain-based jurisdiction hint, not proof that a page supports a claim. */
const COUNTRY_GOVERNMENT_SUFFIXES: Readonly<Record<string, readonly string[]>> = {
  // UAE TDRA identifies u.ae as the government portal:
  // https://tdra.gov.ae/en/About/initiatives/mgov/the-government-official-portal-uae
  AE: ['gov.ae', 'u.ae'], AU: ['gov.au'], BR: ['gov.br'],
  CA: ['gc.ca', 'canada.ca'], CH: ['admin.ch'],
  CN: ['gov.cn'], DE: ['bund.de', 'bundesfinanzministerium.de'], ES: ['gob.es', 'boe.es'], FR: ['gouv.fr'],
  GB: ['gov.uk'], HK: ['gov.hk'], IE: ['gov.ie', 'irishimmigration.ie'],
  IN: ['gov.in'], JP: ['go.jp'], KR: ['go.kr'], MY: ['gov.my'],
  MX: ['gob.mx'], NO: ['regjeringen.no', 'skatteetaten.no'],
  NZ: ['govt.nz'], QA: ['gov.qa'], SA: ['gov.sa'],
  KE: ['go.ke'], PH: ['gov.ph'], NG: ['gov.ng'],
  SE: ['gov.se', 'regeringen.se'],
  SG: ['gov.sg'], SI: ['gov.si'], US: ['gov'], ZA: ['gov.za'],
};

/** Known government hosts suitable for Tavily's domain restriction. */
export function countryGovernmentSearchDomains(countryIso: string): readonly string[] {
  // A bare TLD such as US `.gov` is not a search domain, so do not offer a
  // misleading restricted mode where no concrete suffix is available.
  return (COUNTRY_GOVERNMENT_SUFFIXES[countryIso.toUpperCase()] ?? [])
    .filter(suffix => suffix.includes('.'));
}

export function isCountryGovernmentSource(rawUrl: string, countryIso: string): boolean {
  if (!isOfficialSource(rawUrl)) return false;
  const suffixes = COUNTRY_GOVERNMENT_SUFFIXES[countryIso.toUpperCase()] ?? [];
  const host = new URL(rawUrl).hostname.toLowerCase();
  return suffixes.some(suffix => host === suffix || host.endsWith(`.${suffix}`));
}

export function countOfficial(urls: readonly string[]): number {
  return urls.filter(isOfficialSource).length;
}

/**
 * Cited sources with the official ones first.
 *
 * The adjudicator returns citations in whatever order it used them, which on
 * a live run put an industry association and a law firm's blog above the
 * Federal Register notice they were both describing. Recognized domains are
 * useful to surface even when they do not belong to the issuing body.
 *
 * Stable within each group, so the model's own ordering still decides among
 * sources of equal standing. It reorders; it never drops. An official domain
 * may belong to another agency or jurisdiction, so this is not issuer ranking.
 */
export function officialFirst(urls: readonly string[]): string[] {
  const official: string[] = [];
  const rest: string[] = [];
  for (const url of urls) (isOfficialSource(url) ? official : rest).push(url);
  return [...official, ...rest];
}
