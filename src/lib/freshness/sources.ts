import type { CategoryKey } from '@/lib/data/metrics';
import type { CheckFrequency, MonitoredSource } from './types';

// ---------------------------------------------------------------------------
// Monitored official sources for each country-domain pair.
//
// trustPriority: 1 = official government / head-of-state, 2 = ministry,
//                3 = multilateral, 4 = reputable media, 5 = think tank
//
// checkFrequency: 'high' for immigration (policy changes fast),
//                 'medium' for trade, 'low' for climate
// ---------------------------------------------------------------------------

export const monitoredSources: MonitoredSource[] = [
  // =========================================================================
  // UNITED STATES (US)
  // =========================================================================
  // Climate
  {
    id: 'us-climate-epa',
    countryIso: 'US',
    category: 'climate',
    name: 'U.S. Environmental Protection Agency',
    url: 'https://www.epa.gov/climate-change',
    sourceType: 'government',
    checkFrequency: 'low',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T08:30:00Z',
    lastContentHash: 'a3f1c9e8',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'us-climate-doe',
    countryIso: 'US',
    category: 'climate',
    name: 'U.S. Department of Energy – Clean Energy',
    url: 'https://www.energy.gov/clean-energy',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T12:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'us-trade-ustr',
    countryIso: 'US',
    category: 'trade',
    name: 'Office of the U.S. Trade Representative',
    url: 'https://ustr.gov/trade-agreements',
    sourceType: 'government',
    checkFrequency: 'medium',
    trustPriority: 1,
    lastCheckedAt: '2026-04-15T14:00:00Z',
    lastContentHash: 'b7d2e4f1',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'us-trade-commerce',
    countryIso: 'US',
    category: 'trade',
    name: 'U.S. Department of Commerce – International Trade Administration',
    url: 'https://www.trade.gov/trade-policy',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T09:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'us-immigration-uscis',
    countryIso: 'US',
    category: 'immigration',
    name: 'U.S. Citizenship and Immigration Services',
    url: 'https://www.uscis.gov/newsroom',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-17T06:00:00Z',
    lastContentHash: 'c1a3b5d7',
    isActive: true,
    scrapeMethod: 'rss',
  },
  {
    id: 'us-immigration-cbp',
    countryIso: 'US',
    category: 'immigration',
    name: 'U.S. Customs and Border Protection',
    url: 'https://www.cbp.gov/newsroom',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T22:00:00Z',
    isActive: true,
    scrapeMethod: 'rss',
  },

  // =========================================================================
  // CHINA (CN)
  // =========================================================================
  // Climate
  {
    id: 'cn-climate-mee',
    countryIso: 'CN',
    category: 'climate',
    name: 'Ministry of Ecology and Environment (MEE)',
    url: 'https://english.mee.gov.cn/',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-12T04:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'cn-climate-ndrc',
    countryIso: 'CN',
    category: 'climate',
    name: 'National Development and Reform Commission – Climate Change',
    url: 'https://en.ndrc.gov.cn/',
    sourceType: 'government',
    checkFrequency: 'low',
    trustPriority: 1,
    lastCheckedAt: '2026-04-10T02:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'cn-trade-mofcom',
    countryIso: 'CN',
    category: 'trade',
    name: 'Ministry of Commerce (MOFCOM)',
    url: 'http://english.mofcom.gov.cn/',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-15T06:00:00Z',
    lastContentHash: 'e4f2a1c3',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'cn-immigration-nia',
    countryIso: 'CN',
    category: 'immigration',
    name: 'National Immigration Administration',
    url: 'https://www.nia.gov.cn/n897453/index.html',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T04:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // GERMANY (DE)
  // =========================================================================
  // Climate
  {
    id: 'de-climate-bmwk',
    countryIso: 'DE',
    category: 'climate',
    name: 'Federal Ministry for Economic Affairs and Climate Action (BMWK)',
    url: 'https://www.bmwk.de/Navigation/EN/Topic/topic.html?cl2Categories_LeadKeyword=climate-action',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T10:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'de-climate-uba',
    countryIso: 'DE',
    category: 'climate',
    name: 'German Environment Agency (UBA)',
    url: 'https://www.umweltbundesamt.de/en/topics/climate-energy',
    sourceType: 'government',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-11T08:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'de-trade-bmwk',
    countryIso: 'DE',
    category: 'trade',
    name: 'BMWK – Foreign Trade and Investment Policy',
    url: 'https://www.bmwk.de/Navigation/EN/Topic/topic.html?cl2Categories_LeadKeyword=foreign-trade',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T14:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'de-trade-ec',
    countryIso: 'DE',
    category: 'trade',
    name: 'European Commission – Trade Policy',
    url: 'https://policy.trade.ec.europa.eu/index_en',
    sourceType: 'multilateral',
    checkFrequency: 'medium',
    trustPriority: 3,
    lastCheckedAt: '2026-04-15T10:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'de-immigration-bamf',
    countryIso: 'DE',
    category: 'immigration',
    name: 'Federal Office for Migration and Refugees (BAMF)',
    url: 'https://www.bamf.de/EN/Startseite/startseite_node.html',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-17T07:00:00Z',
    lastContentHash: 'd9c8b7a6',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'de-immigration-bmas',
    countryIso: 'DE',
    category: 'immigration',
    name: 'Federal Ministry of Labour and Social Affairs (BMAS)',
    url: 'https://www.bmas.de/EN/Labour/labour.html',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-16T12:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // UNITED KINGDOM (GB)
  // =========================================================================
  // Climate
  {
    id: 'gb-climate-desnz',
    countryIso: 'GB',
    category: 'climate',
    name: 'Department for Energy Security and Net Zero (DESNZ)',
    url: 'https://www.gov.uk/government/organisations/department-for-energy-security-and-net-zero',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T09:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'gb-trade-dbt',
    countryIso: 'GB',
    category: 'trade',
    name: 'Department for Business and Trade (DBT)',
    url: 'https://www.gov.uk/government/organisations/department-for-business-and-trade',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T15:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'gb-trade-parliament',
    countryIso: 'GB',
    category: 'trade',
    name: 'UK Parliament – International Trade Committee',
    url: 'https://committees.parliament.uk/committee/367/international-trade-committee/',
    sourceType: 'legislature',
    checkFrequency: 'medium',
    trustPriority: 1,
    lastCheckedAt: '2026-04-12T11:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'gb-immigration-home',
    countryIso: 'GB',
    category: 'immigration',
    name: 'Home Office – Immigration and Borders',
    url: 'https://www.gov.uk/government/organisations/home-office',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-17T05:30:00Z',
    lastContentHash: 'f1e2d3c4',
    isActive: true,
    scrapeMethod: 'rss',
  },

  // =========================================================================
  // FRANCE (FR)
  // =========================================================================
  // Climate
  {
    id: 'fr-climate-mte',
    countryIso: 'FR',
    category: 'climate',
    name: 'Ministry of Ecological Transition (MTE)',
    url: 'https://www.ecologie.gouv.fr/politiques-publiques/changement-climatique',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-11T14:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'fr-trade-dgtresor',
    countryIso: 'FR',
    category: 'trade',
    name: 'Directorate General of the Treasury (DG Tresor)',
    url: 'https://www.tresor.economie.gouv.fr/tresor-international',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T10:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'fr-immigration-ofii',
    countryIso: 'FR',
    category: 'immigration',
    name: 'French Office for Immigration and Integration (OFII)',
    url: 'https://www.ofii.fr/',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T18:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'fr-immigration-interior',
    countryIso: 'FR',
    category: 'immigration',
    name: 'Ministry of the Interior – Immigration',
    url: 'https://www.interieur.gouv.fr/actualites/communiques/immigration',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-15T20:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // JAPAN (JP)
  // =========================================================================
  // Climate
  {
    id: 'jp-climate-env',
    countryIso: 'JP',
    category: 'climate',
    name: 'Ministry of the Environment (MOE Japan)',
    url: 'https://www.env.go.jp/en/earth/cc/index.html',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-10T06:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'jp-trade-meti',
    countryIso: 'JP',
    category: 'trade',
    name: 'Ministry of Economy, Trade and Industry (METI)',
    url: 'https://www.meti.go.jp/english/policy/external_economy/index.html',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T03:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'jp-immigration-isa',
    countryIso: 'JP',
    category: 'immigration',
    name: 'Immigration Services Agency of Japan',
    url: 'https://www.moj.go.jp/isa/index.html',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T02:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // INDIA (IN)
  // =========================================================================
  // Climate
  {
    id: 'in-climate-moefcc',
    countryIso: 'IN',
    category: 'climate',
    name: 'Ministry of Environment, Forest and Climate Change (MoEFCC)',
    url: 'https://moef.gov.in/en/division/environment-divisions/climate-changecc-2/',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-09T11:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'in-trade-commerce',
    countryIso: 'IN',
    category: 'trade',
    name: 'Department of Commerce – Ministry of Commerce and Industry',
    url: 'https://commerce.gov.in/trade-policy/',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T08:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'in-trade-dgft',
    countryIso: 'IN',
    category: 'trade',
    name: 'Directorate General of Foreign Trade (DGFT)',
    url: 'https://www.dgft.gov.in/',
    sourceType: 'government',
    checkFrequency: 'medium',
    trustPriority: 1,
    lastCheckedAt: '2026-04-12T07:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'in-immigration-boi',
    countryIso: 'IN',
    category: 'immigration',
    name: 'Bureau of Immigration – Ministry of Home Affairs',
    url: 'https://boi.gov.in/',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T10:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // BRAZIL (BR)
  // =========================================================================
  // Climate
  {
    id: 'br-climate-mma',
    countryIso: 'BR',
    category: 'climate',
    name: 'Ministry of the Environment and Climate Change (MMA)',
    url: 'https://www.gov.br/mma/pt-br',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-11T16:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'br-trade-mdic',
    countryIso: 'BR',
    category: 'trade',
    name: 'Ministry of Development, Industry, Trade and Services (MDIC)',
    url: 'https://www.gov.br/mdic/pt-br',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T18:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'br-immigration-pf',
    countryIso: 'BR',
    category: 'immigration',
    name: 'Federal Police – Immigration Division',
    url: 'https://www.gov.br/pf/pt-br/assuntos/imigracao',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T14:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'br-immigration-mjsp',
    countryIso: 'BR',
    category: 'immigration',
    name: 'Ministry of Justice and Public Security – Migration',
    url: 'https://www.gov.br/mj/pt-br/assuntos/seus-direitos/refugio/migracao',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-15T12:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // AUSTRALIA (AU)
  // =========================================================================
  // Climate
  {
    id: 'au-climate-dcceew',
    countryIso: 'AU',
    category: 'climate',
    name: 'Department of Climate Change, Energy, the Environment and Water (DCCEEW)',
    url: 'https://www.dcceew.gov.au/climate-change',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T01:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'au-trade-dfat',
    countryIso: 'AU',
    category: 'trade',
    name: 'Department of Foreign Affairs and Trade (DFAT)',
    url: 'https://www.dfat.gov.au/trade/trade-and-investment',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T04:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'au-immigration-homeaffairs',
    countryIso: 'AU',
    category: 'immigration',
    name: 'Department of Home Affairs – Immigration and Citizenship',
    url: 'https://www.homeaffairs.gov.au/news-media/news',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-17T00:30:00Z',
    lastContentHash: 'a2b4c6d8',
    isActive: true,
    scrapeMethod: 'rss',
  },

  // =========================================================================
  // CANADA (CA)
  // =========================================================================
  // Climate
  {
    id: 'ca-climate-eccc',
    countryIso: 'CA',
    category: 'climate',
    name: 'Environment and Climate Change Canada (ECCC)',
    url: 'https://www.canada.ca/en/environment-climate-change.html',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-12T15:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'ca-trade-gac',
    countryIso: 'CA',
    category: 'trade',
    name: 'Global Affairs Canada – Trade and Investment',
    url: 'https://www.international.gc.ca/trade-commerce/index.aspx',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T20:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'ca-immigration-ircc',
    countryIso: 'CA',
    category: 'immigration',
    name: 'Immigration, Refugees and Citizenship Canada (IRCC)',
    url: 'https://www.canada.ca/en/immigration-refugees-citizenship/news.html',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-17T03:00:00Z',
    lastContentHash: 'e5f6a7b8',
    isActive: true,
    scrapeMethod: 'rss',
  },
  {
    id: 'ca-immigration-cbsa',
    countryIso: 'CA',
    category: 'immigration',
    name: 'Canada Border Services Agency (CBSA)',
    url: 'https://www.cbsa-asfc.gc.ca/menu-eng.html',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T19:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // SOUTH KOREA (KR)
  // =========================================================================
  // Climate
  {
    id: 'kr-climate-me',
    countryIso: 'KR',
    category: 'climate',
    name: 'Ministry of Environment (ME Korea)',
    url: 'https://eng.me.go.kr/eng/web/index.do?menuId=461',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-10T05:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'kr-trade-motie',
    countryIso: 'KR',
    category: 'trade',
    name: 'Ministry of Trade, Industry and Energy (MOTIE)',
    url: 'https://english.motie.go.kr/en/pc/policymeasures/tradeInvestment/tradeInvestment.do',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-13T07:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'kr-immigration-moj',
    countryIso: 'KR',
    category: 'immigration',
    name: 'Korea Immigration Service – Ministry of Justice',
    url: 'https://www.immigration.go.kr/immigration_eng/index.do',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T08:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // SAUDI ARABIA (SA)
  // =========================================================================
  // Climate
  {
    id: 'sa-climate-moenergy',
    countryIso: 'SA',
    category: 'climate',
    name: 'Ministry of Energy – Sustainability',
    url: 'https://www.moenergy.gov.sa/en/Pages/default.aspx',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-08T09:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'sa-trade-mci',
    countryIso: 'SA',
    category: 'trade',
    name: 'Ministry of Commerce – Trade Policy',
    url: 'https://mc.gov.sa/en/Pages/default.aspx',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-12T13:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'sa-trade-vision2030',
    countryIso: 'SA',
    category: 'trade',
    name: 'Saudi Vision 2030 – Economic Transformation',
    url: 'https://www.vision2030.gov.sa/',
    sourceType: 'government',
    checkFrequency: 'medium',
    trustPriority: 1,
    lastCheckedAt: '2026-04-10T10:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'sa-immigration-moi',
    countryIso: 'SA',
    category: 'immigration',
    name: 'Ministry of Interior – General Directorate of Passports',
    url: 'https://www.moi.gov.sa/wps/portal/Home/sectors/passports',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-15T15:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // NIGERIA (NG)
  // =========================================================================
  // Climate
  {
    id: 'ng-climate-fmenv',
    countryIso: 'NG',
    category: 'climate',
    name: 'Federal Ministry of Environment',
    url: 'https://environment.gov.ng/',
    sourceType: 'ministry',
    checkFrequency: 'low',
    trustPriority: 2,
    lastCheckedAt: '2026-04-07T10:00:00Z',
    isActive: false,
    scrapeMethod: 'html_fetch',
    notes: 'Source intermittently unavailable since March 2026',
  },
  // Trade
  {
    id: 'ng-trade-fmiti',
    countryIso: 'NG',
    category: 'trade',
    name: 'Federal Ministry of Industry, Trade and Investment',
    url: 'https://www.trade.gov.ng/',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-11T09:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'ng-immigration-nis',
    countryIso: 'NG',
    category: 'immigration',
    name: 'Nigeria Immigration Service (NIS)',
    url: 'https://immigration.gov.ng/',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T11:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },

  // =========================================================================
  // SWEDEN (SE)
  // =========================================================================
  // Climate
  {
    id: 'se-climate-naturvardsverket',
    countryIso: 'SE',
    category: 'climate',
    name: 'Swedish Environmental Protection Agency (Naturvardsverket)',
    url: 'https://www.naturvardsverket.se/en/topics/climate/',
    sourceType: 'government',
    checkFrequency: 'low',
    trustPriority: 1,
    lastCheckedAt: '2026-04-12T08:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'se-trade-kommerskollegium',
    countryIso: 'SE',
    category: 'trade',
    name: 'National Board of Trade Sweden (Kommerskollegium)',
    url: 'https://www.kommerskollegium.se/en/',
    sourceType: 'government',
    checkFrequency: 'medium',
    trustPriority: 1,
    lastCheckedAt: '2026-04-14T09:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Immigration
  {
    id: 'se-immigration-migrationsverket',
    countryIso: 'SE',
    category: 'immigration',
    name: 'Swedish Migration Agency (Migrationsverket)',
    url: 'https://www.migrationsverket.se/English/About-the-Migration-Agency/News-archive.html',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-17T06:30:00Z',
    lastContentHash: 'b3c4d5e6',
    isActive: true,
    scrapeMethod: 'rss',
  },

  // =========================================================================
  // SINGAPORE (SG)
  // =========================================================================
  // Climate
  {
    id: 'sg-climate-nccs',
    countryIso: 'SG',
    category: 'climate',
    name: 'National Climate Change Secretariat (NCCS)',
    url: 'https://www.nccs.gov.sg/',
    sourceType: 'government',
    checkFrequency: 'low',
    trustPriority: 1,
    lastCheckedAt: '2026-04-13T05:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'sg-climate-nea',
    countryIso: 'SG',
    category: 'climate',
    name: 'National Environment Agency (NEA)',
    url: 'https://www.nea.gov.sg/our-services/climate-change-energy-efficiency',
    sourceType: 'government',
    checkFrequency: 'low',
    trustPriority: 1,
    lastCheckedAt: '2026-04-11T03:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  // Trade
  {
    id: 'sg-trade-mti',
    countryIso: 'SG',
    category: 'trade',
    name: 'Ministry of Trade and Industry (MTI)',
    url: 'https://www.mti.gov.sg/Trade/Free-Trade-Agreements',
    sourceType: 'ministry',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-14T06:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'sg-trade-esg',
    countryIso: 'SG',
    category: 'trade',
    name: 'Enterprise Singapore – Trade Information',
    url: 'https://www.enterprisesg.gov.sg/grow-your-business/go-global/export',
    sourceType: 'government',
    checkFrequency: 'medium',
    trustPriority: 2,
    lastCheckedAt: '2026-04-12T06:00:00Z',
    isActive: false,
    scrapeMethod: 'html_fetch',
    notes: 'Page restructured; needs scraper update',
  },
  // Immigration
  {
    id: 'sg-immigration-ica',
    countryIso: 'SG',
    category: 'immigration',
    name: 'Immigration & Checkpoints Authority (ICA)',
    url: 'https://www.ica.gov.sg/news-and-publications/newsroom',
    sourceType: 'government',
    checkFrequency: 'high',
    trustPriority: 1,
    lastCheckedAt: '2026-04-16T23:00:00Z',
    isActive: true,
    scrapeMethod: 'html_fetch',
  },
  {
    id: 'sg-immigration-mom',
    countryIso: 'SG',
    category: 'immigration',
    name: 'Ministry of Manpower (MOM) – Work Passes',
    url: 'https://www.mom.gov.sg/newsroom/press-releases',
    sourceType: 'ministry',
    checkFrequency: 'high',
    trustPriority: 2,
    lastCheckedAt: '2026-04-16T21:00:00Z',
    isActive: true,
    scrapeMethod: 'rss',
  },
];

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/** Return all sources for a given country ISO code (case-insensitive). */
export function getSourcesByCountry(iso: string): MonitoredSource[] {
  const upper = iso.toUpperCase();
  return monitoredSources.filter((s) => s.countryIso === upper);
}

/** Return all sources for a given policy domain. */
export function getSourcesByDomain(category: CategoryKey): MonitoredSource[] {
  return monitoredSources.filter((s) => s.category === category);
}

/** Return sources for a specific country + domain pair. */
export function getSourcesForCountryDomain(
  iso: string,
  category: CategoryKey,
): MonitoredSource[] {
  const upper = iso.toUpperCase();
  return monitoredSources.filter(
    (s) => s.countryIso === upper && s.category === category,
  );
}

/**
 * Return active sources whose last check is older than their declared
 * check frequency window:
 *   high   -> 1 day
 *   medium -> 3 days
 *   low    -> 7 days
 */
export function getOverdueChecks(): MonitoredSource[] {
  const now = Date.now();
  const windowMs: Record<CheckFrequency, number> = {
    high: 1 * 24 * 60 * 60 * 1000,   // 1 day
    medium: 3 * 24 * 60 * 60 * 1000, // 3 days
    low: 7 * 24 * 60 * 60 * 1000,    // 7 days
  };

  return monitoredSources.filter((s) => {
    if (!s.isActive) return false;
    if (!s.lastCheckedAt) return true; // never checked = overdue
    const elapsed = now - new Date(s.lastCheckedAt).getTime();
    return elapsed > windowMs[s.checkFrequency];
  });
}
