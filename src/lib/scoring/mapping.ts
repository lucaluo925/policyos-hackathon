/**
 * V5: keyword → submetric mapping.
 *
 * Given a piece of extracted policy text and a domain, return a list of
 * submetric hints: which submetric the text affects, in which direction,
 * with what magnitude, and what rules fired (for audit).
 *
 * We're deliberately conservative:
 *   - `high` confidence requires multiple independent rule matches OR a
 *     direct numeric signal (e.g. "carbon tax: S$45/tonne")
 *   - `medium` confidence is one strong keyword + one modifier
 *   - everything else is `low` confidence and the runner will NOT auto-apply
 *     — it will instead flag a review item so a human can decide.
 *
 * The result also carries the policy type (law | regulation | guidance |
 * proposal) and any parsed numeric values, so the runner persists the
 * whole mapping trace on the PolicyVersion for audit.
 */

import type { Domain } from '@prisma/client';
import { looksLikeProposal } from '@/lib/policy/proposal-detect';

export interface SubmetricHint {
  submetric: string;
  direction: 'positive' | 'negative' | 'neutral' | 'mixed';
  magnitude: number; // 1..5
  confidence: 'high' | 'medium' | 'low';
  firedRules: string[];
}

export interface MappingResult {
  hints: SubmetricHint[];
  numericValues: Record<string, number>;
  mappingRules: string[];
}

type Rule = {
  name: string;
  submetric: string;
  pattern: RegExp;
  direction: 'positive' | 'negative' | 'neutral';
  magnitude: number; // default contribution
  /** Negator patterns flip direction when present. */
  negators?: RegExp[];
};

// ─── Immigration rules ──────────────────────────────────────────────────
const IMMIGRATION_RULES: Rule[] = [
  {
    name: 'imm.quota_increase',
    submetric: 'skilled_migration_accessibility',
    pattern: /\b(increas\w+|rais\w+|expand\w+)\b.{0,30}\b(quota|cap|ceiling|limit)\b/i,
    direction: 'positive',
    magnitude: 3,
  },
  {
    name: 'imm.quota_decrease',
    submetric: 'skilled_migration_accessibility',
    pattern: /\b(reduc\w+|lower\w+|cut\w+|tighten\w+)\b.{0,30}\b(quota|cap|ceiling|limit)\b/i,
    direction: 'negative',
    magnitude: 3,
  },
  {
    name: 'imm.processing_speedup',
    submetric: 'processing_transparency_predictability',
    pattern: /\b(expedit\w+|accelerat\w+|faster processing|shorter processing|reduce.*?processing time)\b/i,
    direction: 'positive',
    magnitude: 2,
  },
  {
    name: 'imm.processing_slowdown',
    submetric: 'processing_transparency_predictability',
    pattern: /\b(longer processing|backlog|processing delays|suspended? processing)\b/i,
    direction: 'negative',
    magnitude: 2,
  },
  {
    name: 'imm.pr_path_open',
    submetric: 'permanent_residency_path_clarity',
    pattern: /\b(permanent residency|green card|PR path|pathway to (?:pr|permanent))\b/i,
    direction: 'positive',
    magnitude: 2,
  },
  {
    name: 'imm.family_reunify',
    submetric: 'family_reunification_openness',
    pattern: /\b(family reunification|family visa|family sponsorship|family based)\b/i,
    direction: 'positive',
    magnitude: 2,
  },
  {
    name: 'imm.asylum_open',
    submetric: 'asylum_humanitarian_openness',
    pattern: /\b(asylum|refugee|humanitarian protection|humanitarian visa)\b/i,
    direction: 'neutral', // route to medium confidence; humans review direction
    magnitude: 2,
  },
  {
    name: 'imm.asylum_restrict',
    submetric: 'asylum_humanitarian_openness',
    pattern: /\b(restrict\w+|tighten\w+|curb)\b.{0,30}\b(asylum|refugee)\b/i,
    direction: 'negative',
    magnitude: 3,
  },
  {
    name: 'imm.employer_dependency',
    submetric: 'employer_dependency_restriction_penalty',
    pattern: /\b(employer sponsor\w+|employer tied|employer dependent|tied visa)\b/i,
    direction: 'negative',
    magnitude: 2,
  },
  {
    name: 'imm.student_to_work',
    submetric: 'student_to_work_transition',
    pattern: /\b(post-study work|graduate visa|optional practical training|opt extension|student to work)\b/i,
    direction: 'positive',
    magnitude: 2,
  },
];

// ─── Climate rules ──────────────────────────────────────────────────────
const CLIMATE_RULES: Rule[] = [
  {
    name: 'cli.carbon_tax_introduced',
    submetric: 'carbon_pricing_or_equivalent',
    pattern: /\b(carbon tax|carbon pricing|carbon levy|ets|emissions trading)\b/i,
    direction: 'positive',
    magnitude: 3,
  },
  {
    name: 'cli.carbon_tax_increase',
    submetric: 'carbon_pricing_or_equivalent',
    pattern: /\b(rais\w+|increas\w+)\b.{0,30}\b(carbon tax|carbon price|carbon levy|cbam)\b/i,
    direction: 'positive',
    magnitude: 4,
  },
  {
    name: 'cli.renewables_target',
    submetric: 'renewable_support_strength',
    pattern: /\b(renewable\w*|solar|wind|offshore wind|green hydrogen)\b.{0,50}\b(target|mandate|incentive|auction|contract for difference)\b/i,
    direction: 'positive',
    magnitude: 3,
  },
  {
    name: 'cli.fossil_fuel_restrict',
    submetric: 'fossil_fuel_constraint_strength',
    pattern: /\b(phase[- ]?out|ban)\b.{0,30}\b(coal|oil|gas|fossil fuel|ice vehicles)\b/i,
    direction: 'positive',
    magnitude: 3,
  },
  {
    name: 'cli.emission_target_strengthened',
    submetric: 'emissions_target_ambition',
    pattern: /\b(net[- ]?zero|ndc|paris agreement|emissions target|greenhouse gas reduction)\b/i,
    direction: 'positive',
    magnitude: 2,
  },
  {
    name: 'cli.adaptation',
    submetric: 'adaptation_resilience_planning',
    pattern: /\b(adaptation|resilience|climate adaptation|flood protection|heat action plan)\b/i,
    direction: 'positive',
    magnitude: 2,
  },
  {
    name: 'cli.international_cooperation',
    submetric: 'international_commitment_alignment',
    pattern: /\b(cop\d+|paris agreement|g7|g20|imo|unfccc)\b/i,
    direction: 'positive',
    magnitude: 1,
  },
];

// ─── Trade rules ────────────────────────────────────────────────────────
const TRADE_RULES: Rule[] = [
  {
    name: 'trd.tariff_cut',
    submetric: 'tariff_openness',
    pattern: /\b(reduc\w+|cut\w+|lower\w+|eliminat\w+)\b.{0,30}\btariff/i,
    direction: 'positive',
    magnitude: 3,
  },
  {
    name: 'trd.tariff_increase',
    submetric: 'tariff_openness',
    pattern: /\b(rais\w+|increas\w+|impos\w+)\b.{0,30}\btariff/i,
    direction: 'negative',
    magnitude: 3,
  },
  {
    name: 'trd.fta_signed',
    submetric: 'fta_network_strength',
    pattern: /\b(free trade agreement|fta|cepa|cptpp|rcep|trade pact|trade deal signed|entered into force)\b/i,
    direction: 'positive',
    magnitude: 3,
  },
  {
    name: 'trd.export_control',
    submetric: 'export_control_restrictiveness_penalty',
    pattern: /\b(export control|export restriction|entity list|sanctions against|chip restriction)\b/i,
    direction: 'negative',
    magnitude: 3,
  },
  {
    name: 'trd.fdi_open',
    submetric: 'foreign_investment_openness',
    pattern: /\b(foreign investment|fdi)\b.{0,30}\b(liberalis\w+|open\w+|permit\w+|welcome\w+)/i,
    direction: 'positive',
    magnitude: 2,
  },
  {
    name: 'trd.fdi_screen',
    submetric: 'foreign_investment_openness',
    pattern: /\b(screening|national security review)\b.{0,40}\b(foreign investment|fdi|mergers)/i,
    direction: 'negative',
    magnitude: 2,
  },
  {
    name: 'trd.protectionism',
    submetric: 'domestic_protectionism_penalty',
    pattern: /\b(anti-dumping|countervailing|safeguard|local content|buy (?:american|domestic))\b/i,
    direction: 'negative',
    magnitude: 2,
  },
  {
    name: 'trd.customs_efficiency',
    submetric: 'customs_efficiency_predictability',
    pattern: /\b(single window|customs modernisation|trusted trader|aeo|authorised economic operator)\b/i,
    direction: 'positive',
    magnitude: 2,
  },
];

const RULES_BY_DOMAIN: Record<Domain, Rule[]> = {
  immigration: IMMIGRATION_RULES,
  climate: CLIMATE_RULES,
  trade: TRADE_RULES,
};

/** Try to pull numeric signals from the text (percentages, quotas, dollar amounts). */
function extractNumerics(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const pctMatches = [...text.matchAll(/(\d{1,3}(?:\.\d+)?)\s*%/g)];
  if (pctMatches[0]) out.percent_primary = parseFloat(pctMatches[0][1]);
  const quotaMatch = text.match(/\b(quota|cap|limit|ceiling)\b.{0,40}?(\d{1,3}(?:,\d{3})+|\d{5,})/i);
  if (quotaMatch) out.quota = parseInt(quotaMatch[2].replace(/,/g, ''), 10);
  const taxMatch = text.match(/\b(?:tax|levy|price)\b.{0,20}?(?:USD?|€|£|S\$|¥)\s?(\d+(?:\.\d+)?)/i);
  if (taxMatch) out.tax_or_price = parseFloat(taxMatch[1]);
  return out;
}

/** V6: numeric + directional rules.
 *
 * Each rule combines (action verb polarity) + (numeric signal presence) + (keyword
 * anchor) to produce a HIGH-confidence hint. A single match of any rule here
 * is enough to auto-apply — these are intentionally stricter than the V5
 * keyword rules so they earn their confidence.
 *
 * Caller passes in pre-extracted actions + numericValues from the deep extractor
 * so we don't re-parse the body text here.
 */
export interface V6ApplyInput {
  domain: Domain;
  actions: Array<{ verb: string; target: string }>;
  numericValues: Record<string, number>;
  bodyText: string; // used only for the keyword anchor check
}

export interface V6Hint {
  submetric: string;
  direction: 'positive' | 'negative';
  magnitude: number;
  rule: string;
  evidence: { verb?: string; target?: string; numeric?: string; value?: number };
}

type V6Rule = {
  name: string;
  domain: Domain;
  submetric: string;
  /** Required keyword anchor in the text. */
  keyword: RegExp;
  /** If set, requires a numeric key present in numericValues. */
  numericKey?: string;
  /** Direction is decided by action polarity + optional flip. */
  defaultDirection?: 'positive' | 'negative';
  /** If true, flip direction when action polarity is negative. */
  flippable?: boolean;
};

const V6_RULES: V6Rule[] = [
  // ── climate ──
  {
    name: 'v6.cli.carbon_tax_rate',
    domain: 'climate',
    submetric: 'carbon_pricing_or_equivalent',
    keyword: /\b(carbon tax|carbon price|carbon levy|co2 tax|ets)\b/i,
    numericKey: 'carbon_tax_pct',
    flippable: true,
    defaultDirection: 'positive',
  },
  {
    name: 'v6.cli.carbon_tax_rate_currency',
    domain: 'climate',
    submetric: 'carbon_pricing_or_equivalent',
    keyword: /\b(carbon tax|carbon price|carbon levy)\b/i,
    // Any of these currency-per-tonne keys → HIGH confidence
    numericKey: 'sgd_per_tonne',
    flippable: true,
    defaultDirection: 'positive',
  },
  {
    name: 'v6.cli.carbon_tax_rate_eur',
    domain: 'climate',
    submetric: 'carbon_pricing_or_equivalent',
    keyword: /\b(carbon tax|carbon price|carbon levy)\b/i,
    numericKey: 'eur_per_tonne',
    flippable: true,
    defaultDirection: 'positive',
  },
  {
    name: 'v6.cli.emission_reduction_pct',
    domain: 'climate',
    submetric: 'emissions_target_ambition',
    keyword: /\b(emission|ghg|greenhouse gas|net[- ]?zero)\b/i,
    numericKey: 'emission_reduction_pct',
    defaultDirection: 'positive',
  },
  {
    name: 'v6.cli.renewable_target',
    domain: 'climate',
    submetric: 'renewable_support_strength',
    keyword: /\brenewable\w*/i,
    numericKey: 'renewable_target_pct',
    defaultDirection: 'positive',
  },
  {
    name: 'v6.cli.renewable_funding',
    domain: 'climate',
    submetric: 'renewable_support_strength',
    // Fires when a currency-denominated funding amount is attached to a
    // renewable/clean-energy keyword — e.g. "£64 million for offshore wind".
    keyword: /\b(solar|wind|offshore wind|hydrogen|renewable|fusion|heat networks?|electric vehicles?|ev charging|battery storage)\b/i,
    numericKey: 'renewable_funding_amount_m',
    defaultDirection: 'positive',
  },
  // ── trade ──
  {
    name: 'v6.trd.tariff_pct',
    domain: 'trade',
    submetric: 'tariff_openness',
    keyword: /\btariff/i,
    numericKey: 'tariff_pct',
    flippable: true,
    // Default assumes new tariff → negative for openness
    defaultDirection: 'negative',
  },
  {
    name: 'v6.trd.tariff_change_from_to',
    domain: 'trade',
    submetric: 'tariff_openness',
    keyword: /\btariff/i,
    // When change_from + change_to both present we can infer direction from them
    numericKey: 'change_from',
    defaultDirection: 'negative',
  },
  // ── immigration ──
  {
    name: 'v6.imm.quota_numeric',
    domain: 'immigration',
    submetric: 'skilled_migration_accessibility',
    keyword: /\b(quota|cap|ceiling|limit)\b/i,
    numericKey: 'quota',
    flippable: true,
    defaultDirection: 'positive',
  },
];

// ─── V7: evidence-tier rules ───────────────────────────────────────────
// "medium" rules fire when we see a clear policy action + relevant keyword
// but no numeric anchor. They auto-apply at reduced magnitude (1 instead of 3).

export type EvidenceTier = 'strong' | 'medium' | 'weak';

export interface V7Tier {
  tier: EvidenceTier;
  hints: V6Hint[];
  firedRules: string[];
}

type MediumRule = {
  name: string;
  domain: Domain;
  submetric: string;
  keyword: RegExp;
  /** Direction decided from action polarity when flippable, else default. */
  defaultDirection: 'positive' | 'negative';
  flippable?: boolean;
};

const MEDIUM_RULES: MediumRule[] = [
  // ── climate ──
  {
    name: 'v7.cli.carbon_tax_action',
    domain: 'climate',
    submetric: 'carbon_pricing_or_equivalent',
    keyword: /\b(carbon tax|carbon price|emissions trading|cbam)\b/i,
    defaultDirection: 'positive',
    flippable: true,
  },
  {
    name: 'v7.cli.renewable_action',
    domain: 'climate',
    submetric: 'renewable_support_strength',
    keyword: /\b(solar|offshore wind|wind farm|renewable|green hydrogen|fusion|battery storage|heat networks?)\b/i,
    defaultDirection: 'positive',
    flippable: true,
  },
  {
    name: 'v7.cli.fossil_fuel_action',
    domain: 'climate',
    submetric: 'fossil_fuel_constraint_strength',
    keyword: /\b(phase[- ]?out|ban|end of|exit)\b.{0,40}\b(coal|oil|gas|fossil fuel|combustion engine|ice vehicle)\b/i,
    defaultDirection: 'positive',
  },
  {
    name: 'v7.cli.adaptation_action',
    domain: 'climate',
    submetric: 'adaptation_resilience_planning',
    keyword: /\b(adaptation|resilience|flood|drought|heat plan|climate risk)\b/i,
    defaultDirection: 'positive',
  },
  // ── trade ──
  {
    name: 'v7.trd.fta_action',
    domain: 'trade',
    submetric: 'fta_network_strength',
    keyword: /\b(free trade agreement|fta|cepa|cptpp|rcep|trade deal|trade pact|entered into force)\b/i,
    defaultDirection: 'positive',
  },
  {
    name: 'v7.trd.tariff_action',
    domain: 'trade',
    submetric: 'tariff_openness',
    keyword: /\btariff/i,
    defaultDirection: 'negative',
    flippable: true,
  },
  {
    name: 'v7.trd.export_control_action',
    domain: 'trade',
    submetric: 'export_control_restrictiveness_penalty',
    keyword: /\b(export control|entity list|sanctions|chip restriction|dual[- ]?use)\b/i,
    defaultDirection: 'negative',
  },
  {
    name: 'v7.trd.customs_action',
    domain: 'trade',
    submetric: 'customs_efficiency_predictability',
    keyword: /\b(single window|trusted trader|aeo|authorised economic operator|customs modernisation)\b/i,
    defaultDirection: 'positive',
  },
  // ── immigration ──
  {
    name: 'v7.imm.skilled_action',
    domain: 'immigration',
    submetric: 'skilled_migration_accessibility',
    keyword: /\b(skilled (?:worker|migration)|high-skilled|talent visa|tech visa|startup visa)\b/i,
    defaultDirection: 'positive',
    flippable: true,
  },
  {
    name: 'v7.imm.processing_action',
    domain: 'immigration',
    submetric: 'processing_transparency_predictability',
    keyword: /\b(processing time|expedit\w+|faster processing|backlog|service standard)\b/i,
    defaultDirection: 'positive',
    flippable: true,
  },
  {
    name: 'v7.imm.pr_action',
    domain: 'immigration',
    submetric: 'permanent_residency_path_clarity',
    keyword: /\b(permanent residency|green card|pr path|settlement route)\b/i,
    defaultDirection: 'positive',
    flippable: true,
  },
  {
    name: 'v7.imm.family_action',
    domain: 'immigration',
    submetric: 'family_reunification_openness',
    keyword: /\b(family reunification|family visa|dependant|spouse visa)\b/i,
    defaultDirection: 'positive',
    flippable: true,
  },
];

/**
 * V8: return all sentences in `text` that contain `keyword`. Used for
 * context-bounded rule firing — we only treat a keyword as real evidence
 * if it co-occurs with an action verb inside the same sentence-sized
 * window (~200 chars), so page chrome keywords like "Net Zero" in the
 * DESNZ department name don't nudge scores.
 */
function sentencesContaining(text: string, keyword: RegExp): string[] {
  // Cheap sentence split; fine for our use.
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])|\n+/);
  return sentences.filter((s) => keyword.test(s));
}

const ACTION_REGEX_POSITIVE = /\b(increase|raise|introduce|launch|expand|extend|sign|enter into force|commit|invest|fund|back|pledge|announce)\w*/i;
const ACTION_REGEX_NEGATIVE = /\b(reduce|cut|lower|ban|prohibit|phase out|suspend|repeal|remove|impose|restrict|curb|tighten)\w*/i;

/** Polarity of a single sentence (not the whole body). */
function localPolarity(sentence: string): 'positive' | 'negative' | 'neutral' {
  const pos = ACTION_REGEX_POSITIVE.test(sentence);
  const neg = ACTION_REGEX_NEGATIVE.test(sentence);
  if (pos && !neg) return 'positive';
  if (neg && !pos) return 'negative';
  if (pos && neg) return 'neutral';
  return 'neutral';
}

export function applyV7Tiered(input: V6ApplyInput): V7Tier {
  // 1. Strong tier: V6 numeric-triggered rules.
  const v6 = applyV6Rules(input);
  if (v6.length > 0) {
    return {
      tier: 'strong',
      hints: v6,
      firedRules: v6.map((h) => h.rule),
    };
  }

  // 2. Medium tier: V8 context-bounded. A rule fires only when its
  // keyword co-occurs with a directional action in the SAME sentence
  // window. This eliminates "adaptation" in a BMUV sidebar nav triggering
  // a score change for every page on the site.
  const mediumHints: V6Hint[] = [];
  const firedRules: string[] = [];
  for (const rule of MEDIUM_RULES) {
    if (rule.domain !== input.domain) continue;
    const windows = sentencesContaining(input.bodyText, rule.keyword);
    if (windows.length === 0) continue;

    // Prefer a window that also contains an action verb; skip the rule
    // entirely if no matching sentence has a directional action.
    let chosenWindow: string | null = null;
    let windowPolarity: 'positive' | 'negative' | 'neutral' = 'neutral';
    for (const w of windows) {
      const p = localPolarity(w);
      if (p !== 'neutral') {
        chosenWindow = w;
        windowPolarity = p;
        break;
      }
    }
    if (!chosenWindow) continue;

    let direction = rule.defaultDirection;
    if (rule.flippable) {
      if (windowPolarity !== 'neutral') direction = windowPolarity;
    }
    firedRules.push(rule.name);
    mediumHints.push({
      submetric: rule.submetric,
      direction,
      magnitude: 1,
      rule: rule.name,
      evidence: {
        verb: chosenWindow.match(ACTION_REGEX_POSITIVE)?.[0] ?? chosenWindow.match(ACTION_REGEX_NEGATIVE)?.[0],
        target: chosenWindow.slice(0, 80),
      },
    });
  }
  if (mediumHints.length > 0) {
    return { tier: 'medium', hints: mediumHints, firedRules };
  }

  // 3. Weak: V5 keyword mapping (if anything matched); no auto-apply.
  return { tier: 'weak', hints: [], firedRules: [] };
}


/* A dead `aggregateActionPolarity` sat here. It was NOT an unrendered feature
   like the two found earlier today: it duplicated the polarity counting
   inlined in applyV6Rules below, with a different verb list, and its extra
   entries were wrong rather than missing -- it counted `sign` and `enter` as
   positive, so "signed an order banning X" would have come out positive.
   `impose` and `restrict` are genuinely negative policy verbs and are in
   neither list; measured across 44 live deep items, "imposed" appeared once,
   which is too thin to change a scoring table on. Deleted, and the question
   recorded rather than acted on. */

export function applyV6Rules(input: V6ApplyInput): V6Hint[] {
  const hints: V6Hint[] = [];
  const { domain, actions, numericValues, bodyText } = input;

  // Compute aggregate action polarity (positive / negative / none)
  const polarityCounts = { positive: 0, negative: 0 };
  for (const a of actions) {
    const v = a.verb.toLowerCase();
    const isPos = /\b(increase|raise|introduce|launch|expand|extend)\w*/.test(v);
    const isNeg = /\b(reduce|cut|lower|ban|prohibit|phase out|suspend|repeal|remove)\w*/.test(v);
    if (isPos) polarityCounts.positive++;
    if (isNeg) polarityCounts.negative++;
  }

  for (const rule of V6_RULES) {
    if (rule.domain !== domain) continue;
    if (!rule.keyword.test(bodyText)) continue;
    if (rule.numericKey && !(rule.numericKey in numericValues)) continue;

    let direction: 'positive' | 'negative' = rule.defaultDirection ?? 'positive';

    // Flip direction based on action polarity + from/to value comparison
    if (rule.flippable) {
      if (polarityCounts.negative > polarityCounts.positive) {
        direction = direction === 'positive' ? 'negative' : 'positive';
      }
      if (
        rule.name === 'v6.trd.tariff_change_from_to' &&
        numericValues.change_from != null &&
        numericValues.change_to != null
      ) {
        direction = numericValues.change_to < numericValues.change_from ? 'positive' : 'negative';
      }
    }

    const value = rule.numericKey ? numericValues[rule.numericKey] : undefined;
    hints.push({
      submetric: rule.submetric,
      direction,
      magnitude: 3,
      rule: rule.name,
      evidence: {
        verb: actions[0]?.verb,
        target: actions[0]?.target,
        numeric: rule.numericKey,
        value,
      },
    });
  }
  return hints;
}

/** Detect policy type from keyword context. */
export function detectPolicyType(text: string): 'law' | 'regulation' | 'guidance' | 'proposal' {
  const t = text.toLowerCase();
  // Instrument-level, not bare keywords: "draft benefit requests" in a live
  // USCIS guidance chapter used to make it a proposal. See
  // lib/policy/proposal-detect.ts.
  if (looksLikeProposal(text)) {
    return 'proposal';
  }
  if (/\b(signed into law|enacted|act of|statute|statutory instrument|royal assent)\b/.test(t)) {
    return 'law';
  }
  if (/\b(regulation|decree|order|ministerial order|gazette)\b/.test(t)) {
    return 'regulation';
  }
  return 'guidance';
}

/** Main entry: run the keyword rules over the text and return hints + trace. */
export function mapTextToSubmetrics(text: string, domain: Domain): MappingResult {
  const rules = RULES_BY_DOMAIN[domain] ?? [];
  const perSubmetric = new Map<string, SubmetricHint>();
  const firedRuleNames: string[] = [];

  for (const rule of rules) {
    if (!rule.pattern.test(text)) continue;
    firedRuleNames.push(rule.name);

    const existing = perSubmetric.get(rule.submetric);
    if (!existing) {
      perSubmetric.set(rule.submetric, {
        submetric: rule.submetric,
        direction: rule.direction,
        magnitude: rule.magnitude,
        confidence: 'medium',
        firedRules: [rule.name],
      });
    } else {
      existing.firedRules.push(rule.name);
      // Two concordant rules on the same submetric → high confidence
      if (existing.direction === rule.direction || rule.direction === 'neutral') {
        existing.confidence = 'high';
        existing.magnitude = Math.min(5, existing.magnitude + 1);
      } else {
        // Conflicting directions → flag as mixed and drop confidence
        existing.direction = 'mixed';
        existing.confidence = 'low';
      }
    }
  }

  const numericValues = extractNumerics(text);
  // A numeric signal on a matched submetric bumps confidence to `high`.
  if (Object.keys(numericValues).length > 0) {
    for (const hint of perSubmetric.values()) {
      if (hint.confidence === 'medium') hint.confidence = 'high';
    }
  }

  return {
    hints: [...perSubmetric.values()],
    numericValues,
    mappingRules: firedRuleNames,
  };
}
