/**
 * Deterministic tagger for Federal Register documents.
 *
 * Keyword rules only — no model calls — so the same document always gets the
 * same tags and the rule set can be versioned. `relevant` is a *candidate*
 * flag: every event still goes through human review before it enters the
 * event study (PolicyEvent.reviewStatus).
 */

import type { EventDirection, EventType, FrDocument, TagResult } from './types';

export const TAGGER_VERSION = 'fr-tagger-v2';

export const BIS_SLUG = 'industry-and-security-bureau';
export const USTR_SLUG = 'trade-representative-office-of-united-states';

const RX = {
  entityList: /\bentity list\b/i,
  advancedComputing:
    /advanced computing|semiconductor manufacturing|supercomputer|integrated circuits?\b/i,
  section301: /section 301/i,
  s301Exclusion:
    /\bexclusions?\b|request(?:s)? to exclude|procedures for requests|request for comments concerning the extension/i,
  // Title-level markers of non-substantive documents. "Updates and Corrections"
  // mid-title is part of real rule names (Oct-2023), so corrections only count
  // as a trailing "; Correction(s)" / "Corrections and Clarifications" suffix.
  procedural:
    /public briefing|procedures for access|extension of comment period|;\s*corrections?\s*$|;\s*corrections and clarifications\s*$|^corrections?\b/i,
  // Only standalone TGL renewals; Aug-2020 "Addition of Huawei … Removal of
  // Temporary General License" is a major tightening rule, not a renewal.
  tgl: /^temporary general license/i,
  china:
    /\bChina\b|People['’]s Republic of China|\bPRC\b|\bChinese\b|Hong Kong|Macau|Huawei|\bSMIC\b|\bZTE\b|\bYMTC\b|\bCXMT\b|Hikvision/i,
  semis:
    /semiconductor|integrated circuits?\b|advanced computing|\bchips?\b|lithograph|\bwafers?\b|\bfoundry\b|supercomputer|\bSMIC\b|\bYMTC\b|\bCXMT\b|Huawei/i,
  easing:
    /\bremov(?:al|e|es|ing)\b|\bdelet(?:e|es|ion|ing)\b|\brescission\b|extension of (?:certain )?exclusions|exclusion extensions?|exclusions? granted|\brelief\b/i,
  tightening:
    /\baddition(?:s|al)?\b|\badd(?:s|ing)?\b|\bexpan(?:d|ds|sion)\b|\brestrict(?:s|ion|ions|ive)?\b|\bimpos(?:e|es|ition|ing)\b|\bnew controls\b|\bcontrols on\b|\bincreas(?:e|es|ing)\b/i,
};

function agencySlugs(doc: FrDocument): string[] {
  return (doc.agencies ?? []).map((a) => a.slug ?? '').filter(Boolean);
}

export interface TagOptions {
  /** Full-text semiconductor hits (entity names) from `semisHitsFromBody`. */
  bodySemisHits?: string[];
}

export function tagDocument(doc: FrDocument, opts: TagOptions = {}): TagResult {
  const text = [doc.title, doc.action ?? '', doc.abstract ?? ''].join(' \n ');
  const slugs = agencySlugs(doc);
  const isBis = slugs.includes(BIS_SLUG);
  const isUstr = slugs.includes(USTR_SLUG);
  const fired: string[] = [];

  const hit = (name: keyof typeof RX, on = text) => {
    const ok = RX[name].test(on);
    if (ok) fired.push(name);
    return ok;
  };

  // Rule *subject* is judged on title + action. Abstracts name companies
  // ("Semiconductor Manufacturing International Corp.") that would otherwise
  // make every SMIC Entity List addition look like an advanced-computing rule.
  const headline = [doc.title, doc.action ?? ''].join(' ');
  const s301 = isUstr && hit('section301');
  const adv = hit('advancedComputing', headline);
  const ent = hit('entityList');
  const tgl = isBis && hit('tgl', doc.title);
  const procedural = hit('procedural', doc.title);
  const chinaRelated = hit('china');
  const bodyHits = opts.bodySemisHits ?? [];
  if (bodyHits.length) fired.push(...bodyHits.map((h) => `body:${h}`));
  // Only named entities count; generic body keywords are recorded for review
  // but do not by themselves make a rule semis-relevant.
  const semisRelated = hit('semis') || bodyHits.some((h) => !h.startsWith('keyword:'));

  let eventType: EventType;
  if (s301) eventType = hit('s301Exclusion', doc.title) ? 'section_301_exclusion' : 'section_301_action';
  else if (tgl) eventType = 'tgl_extension';
  else if (isBis && procedural) eventType = 'procedural';
  else if (adv && isBis) eventType = 'advanced_computing_semis';
  else if (ent && isBis) eventType = 'entity_list';
  else if (isBis) eventType = 'export_control_other';
  else eventType = 'other';

  // Direction is judged on the headline only: abstracts routinely mention
  // both "add" and "remove" boilerplate and would make everything "unclear".
  const tight = RX.tightening.test(headline);
  const ease = RX.easing.test(headline);
  let direction: EventDirection = 'unclear';
  if (tight && !ease) direction = 'tightening';
  else if (ease && !tight) direction = 'easing';
  else if (tight && ease && eventType === 'entity_list' && /\baddition/i.test(doc.title)) {
    // Omnibus Entity List rules ("Addition…, Revision…, and Removal…") are
    // dominated by additions; flag for review rather than drop as unclear.
    direction = 'tightening';
    fired.push('dir_mixed_additions_dominant');
  }
  if (tight) fired.push('dir_tightening');
  if (ease) fired.push('dir_easing');

  // Advanced-computing / SME rules are China-targeted by construction; their
  // abstracts often say "certain destinations" without naming the PRC.
  const relevant =
    eventType === 'advanced_computing_semis' ||
    (eventType === 'entity_list' && chinaRelated && semisRelated);

  return { eventType, chinaRelated, semisRelated, direction, relevant, firedRules: fired };
}

/**
 * Chinese semiconductor / advanced-computing entities whose appearance in an
 * Entity List rule's *body* marks the rule as semis-relevant. Abstracts rarely
 * list entity names, so this runs on the FR raw text.
 */
export const SEMIS_ENTITY_PATTERNS: Array<[string, RegExp]> = [
  ['SMIC', /Semiconductor Manufacturing International|\bSMIC\b/i],
  ['YMTC', /Yangtze Memory|\bYMTC\b/i],
  ['CXMT', /ChangXin Memory|\bCXMT\b/i],
  ['Huawei', /\bHuawei\b|HiSilicon/i],
  ['Fujian Jinhua', /Fujian Jinhua/i],
  ['Phytium', /Phytium/i],
  ['Sunway', /Sunway|National Supercomputing Center/i],
  ['Sugon', /\bSugon\b|Dawning Information/i],
  ['Inspur', /\bInspur\b/i],
  ['SMEE', /Shanghai Micro Electronics Equipment|\bSMEE\b/i],
  ['Cambricon', /Cambricon/i],
  ['Biren', /\bBiren\b/i],
  ['Moore Threads', /Moore Threads/i],
  ['Hua Hong', /Hua Hong|Huali Microelectronics/i],
  ['Piotech', /Piotech/i],
  ['Naura', /\bNaura\b|North Huachuang/i],
  ['keyword:integrated circuit', /integrated circuits?\b/i],
  ['keyword:semiconductor', /\bsemiconductors?\b/i],
];

export function semisHitsFromBody(body: string): string[] {
  return SEMIS_ENTITY_PATTERNS.filter(([, rx]) => rx.test(body)).map(([name]) => name);
}

/** Only BIS Entity List documents that look China-related need the body pass. */
export function needsBodyScan(doc: FrDocument): boolean {
  const t = tagDocument(doc);
  return t.eventType === 'entity_list' && t.chinaRelated && !t.semisRelated;
}
