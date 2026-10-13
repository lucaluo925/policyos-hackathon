/**
 * Keyword topic classifier for general government feeds (a head-of-government
 * newsroom mixes culture, sport, security, ...). An item is kept only when its
 * title clearly names one of our three topics; everything else is dropped.
 *
 * Title-only on purpose: summaries of general releases mention many things in
 * passing, which produces false positives. Languages: en, de, fr, pt, sv, hi.
 */
import type { Domain } from '@prisma/client';

const RULES: Array<[Domain, RegExp]> = [
  [
    'immigration',
    new RegExp(
      [
        // en
        'immigra', '\\bmigrants?\\b', '\\bmigration(?! of birds)', '\\bvisas?\\b', 'asylum', 'refugee', 'citizenship', 'naturali[sz]ation',
        'border (security|control|protection|crossing)', 'deport', 'work permit', 'study permit', 'permanent resid',
        // de
        'zuwanderung', 'einwanderung', 'migration', '\\basyl', 'flüchtling', 'geflüchtet', '\\bvisum', 'einbürgerung',
        'staatsangehörigkeit', 'abschiebung', 'grenzkontroll', 'fachkräfteeinwanderung',
        // fr
        '\\basile\\b', 'réfugié', 'titre de séjour',
        // pt
        'imigra', 'refugiad', '\\basilo\\b', '\\bvistos?\\b', 'naturaliza',
        // sv
        '\\basyl', 'uppehållstillstånd', 'medborgarskap', 'arbetstillstånd', 'flykting', 'migrations',
        // hi
        'प्रवासन', 'आप्रवासन', 'वीज़ा', 'वीजा', 'शरणार्थी', 'नागरिकता',
      ].join('|'),
      'i',
    ),
  ],
  [
    'trade',
    new RegExp(
      [
        // en
        '\\btrade\\b', 'tariff', '\\bexports?\\b', '\\bimports?\\b', '\\bcustoms\\b', 'free trade', 'anti-dumping',
        'countervailing', 'sanction', 'economic partnership', '\\bWTO\\b', 'supply chain', 'foreign exchange and foreign trade', 'FEFTA',
        // de
        '(frei)?handel(s\\w*)?\\b', '\\bzoll', 'zölle', '\\bexport', '\\bimport(e|s|verbot|zoll|zölle)?\\b', 'lieferkette', 'sanktion',
        // fr
        '\\bcommerce\\b', 'accord commercial', 'douane', 'libre-échange', 'exportation', 'importation',
        // pt
        'comércio', 'exportaç', 'importaç', '\\btarifa', 'aduan', 'mercosul', 'acordo comercial',
        // sv
        '\\bhandel', '\\btull',
        // hi
        'व्यापार', 'निर्यात', 'आयात', 'सीमा शुल्क',
      ].join('|'),
      'i',
    ),
  ],
  [
    'climate',
    new RegExp(
      [
        // en
        'climate', 'emission', 'net[- ]zero', '\\bcarbon', 'renewable', '\\bsolar\\b', 'wind (farm|power|energy)', 'offshore wind',
        'clean energy', 'energy transition', 'decarboni', 'greenhouse', 'fossil fuel', '\\bCOP ?\\d\\d\\b', 'electric vehicle',
        // de
        '\\bklima', 'erneuerbar', 'windpark', 'windenergie', '\\bco2', 'energiewende', 'fossil', 'kohleausstieg', 'wasserstoff',
        // fr
        '\\bclimat', 'émission', 'renouvelable', '\\bcarbone', 'transition énergétique', 'éolien',
        // pt
        '\\bclima\\b', 'climátic', 'emissões', 'renováve', '\\bcarbono', 'desmatamento', 'transição energética', 'eólic',
        // sv
        '\\bklimat', 'utsläpp', 'förnybar',
        // hi
        'जलवायु', 'उत्सर्जन', 'नवीकरणीय', 'सौर ऊर्जा', 'हरित ऊर्जा', 'कार्बन',
      ].join('|'),
      'i',
    ),
  ],
];

export function classifyDomain(text: string): Domain | null {
  for (const [domain, re] of RULES) if (re.test(text)) return domain;
  return null;
}
