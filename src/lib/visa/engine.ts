/**
 * Visa Intelligence engine — deterministic, policy-aware probability estimator.
 *
 * NOT legal advice. The engine returns a probability *band*, a confidence
 * level, a structured risk breakdown, references to current PolicyOS
 * policy versions, and concrete improvement suggestions. No single numeric
 * percentage is exposed externally — outputs are always banded.
 *
 * The scoring is a weighted sum of factor contributions, then mapped to
 * bands. Factor weights are transparent and listed below so users can
 * inspect what drove a result.
 *
 * PolicyOS integration: the engine pulls the destination country's current
 * immigration DomainScore + recent ScoreChangeLog entries. A declining
 * immigration score (tightening) reduces the band; a rising score
 * (liberalisation) raises it. Relevant PolicyVersions are surfaced in the
 * output so the user can click through to the source policies.
 */

import type { VerificationConfidence } from '@prisma/client';
import { prisma } from '@/lib/db/client';

export type VisaType = 'student' | 'work' | 'pr' | 'visit' | 'family';
export type ProbabilityBand =
  | 'very_low'   // <20%
  | 'low'        // 20–40%
  | 'medium'     // 40–60%
  | 'medium_high'// 60–75%
  | 'high';      // 75–90%

export interface VisaInput {
  countryIso: string; // ISO2 preferred
  visaType: VisaType;
  education: 'none' | 'highschool' | 'bachelor' | 'master' | 'phd';
  field?: string;
  yearsExperience: number;
  englishLevel: 'none' | 'basic' | 'intermediate' | 'fluent' | 'native';
  annualSalaryUsd?: number;
  previousVisasDenied: number;
  previousVisasApproved: number;
  criminalRecord: boolean;
  sponsorship: 'none' | 'employer' | 'family' | 'institutional';
}

export interface VisaRiskBreakdown {
  refusalRisk: 'low' | 'medium' | 'high';
  financialSufficiency: 'low' | 'medium' | 'high';
  policyUncertainty: 'low' | 'medium' | 'high';
  countrySpecificScrutiny: 'low' | 'medium' | 'high';
}

export interface PolicyLinkage {
  policyId: string;
  title: string;
  summary?: string | null;
  sourceUrl?: string | null;
  recentChange?: {
    at: string;
    delta: number;
    direction: 'tightening' | 'liberalising' | 'neutral';
  };
}

export interface VisaAssessment {
  band: ProbabilityBand;
  bandLabel: string; // e.g. "Medium-high (60–75%)"
  confidence: 'high' | 'medium' | 'low';
  factors: Array<{ key: string; contribution: number; note: string }>;
  risks: VisaRiskBreakdown;
  improvements: Array<{ suggestion: string; expectedGain: number }>;
  policyLinks: PolicyLinkage[];
  immigrationScore: number | null; // 0–100 from DomainScore
  immigrationTrend: 'tightening' | 'liberalising' | 'stable' | 'unknown';
  disclaimers: string[];
  generatedAt: string;
}

// Weights: each factor contributes a signed value in roughly [-30, +30].
// Final score is in roughly [-100, +100] then shifted to 0–100 band mapping.
function scoreEducation(e: VisaInput['education'], visaType: VisaType): number {
  const base = { none: -10, highschool: 0, bachelor: 8, master: 14, phd: 18 }[e];
  // Student visas weight prior education less heavily; PR weights it more.
  const multiplier = visaType === 'student' ? 0.6 : visaType === 'pr' ? 1.3 : 1.0;
  return base * multiplier;
}

function scoreExperience(years: number, visaType: VisaType): number {
  if (visaType === 'student') return Math.min(years, 3) * 1.5;
  return Math.min(years, 10) * 2;
}

function scoreEnglish(l: VisaInput['englishLevel']): number {
  return { none: -12, basic: -4, intermediate: 4, fluent: 10, native: 12 }[l];
}

function scoreSalary(usd: number | undefined, visaType: VisaType): { c: number; sufficiency: 'low' | 'medium' | 'high' } {
  if (visaType === 'student' || visaType === 'visit' || visaType === 'family') {
    // Financial sufficiency threshold instead of salary.
    if (!usd) return { c: -2, sufficiency: 'medium' };
    if (usd >= 20_000) return { c: 6, sufficiency: 'high' };
    if (usd >= 10_000) return { c: 2, sufficiency: 'medium' };
    return { c: -6, sufficiency: 'low' };
  }
  if (!usd) return { c: -6, sufficiency: 'low' };
  if (usd >= 80_000) return { c: 14, sufficiency: 'high' };
  if (usd >= 50_000) return { c: 8, sufficiency: 'high' };
  if (usd >= 35_000) return { c: 2, sufficiency: 'medium' };
  return { c: -8, sufficiency: 'low' };
}

function scoreHistory(approved: number, denied: number): number {
  return Math.min(approved, 5) * 2 - denied * 12;
}

function scoreCriminal(hasRecord: boolean): number {
  return hasRecord ? -25 : 0;
}

function scoreSponsor(s: VisaInput['sponsorship'], visaType: VisaType): number {
  const base = { none: 0, employer: 10, family: 6, institutional: 8 }[s];
  return visaType === 'work' && s === 'employer' ? base + 4 : base;
}

function bandFromScore(score: number): { band: ProbabilityBand; label: string } {
  if (score >= 60) return { band: 'high', label: 'High (75–90%)' };
  if (score >= 35) return { band: 'medium_high', label: 'Medium-high (60–75%)' };
  if (score >= 10) return { band: 'medium', label: 'Medium (40–60%)' };
  if (score >= -15) return { band: 'low', label: 'Low (20–40%)' };
  return { band: 'very_low', label: 'Very low (<20%)' };
}

function inputCompleteness(input: VisaInput): number {
  let filled = 0;
  let total = 0;
  const keys: Array<keyof VisaInput> = [
    'education', 'yearsExperience', 'englishLevel', 'annualSalaryUsd',
    'previousVisasDenied', 'previousVisasApproved', 'sponsorship',
  ];
  for (const k of keys) {
    total++;
    const v = input[k];
    if (v !== undefined && v !== null && v !== '' && v !== 0 && v !== 'none') filled++;
  }
  return filled / total;
}

/** Hard disclaimer text — always surfaced in the UI. */
export const DISCLAIMERS = [
  'This is NOT legal advice.',
  'Results are estimates based on publicly available policy data in PolicyOS.',
  'Actual visa decisions depend on case officers, documentation, and factors this model cannot see.',
  'Numbers are presented as ranges; no exact approval percentage is promised.',
];

export async function assessVisa(input: VisaInput): Promise<VisaAssessment> {
  // ─── Factor contributions ───────────────────────────────────────────
  const factors: VisaAssessment['factors'] = [];
  const edu = scoreEducation(input.education, input.visaType);
  factors.push({ key: 'education', contribution: edu, note: `education=${input.education}` });
  const exp = scoreExperience(input.yearsExperience, input.visaType);
  factors.push({ key: 'experience', contribution: exp, note: `${input.yearsExperience} yrs` });
  const eng = scoreEnglish(input.englishLevel);
  factors.push({ key: 'english', contribution: eng, note: `level=${input.englishLevel}` });
  const sal = scoreSalary(input.annualSalaryUsd, input.visaType);
  factors.push({
    key: 'salary',
    contribution: sal.c,
    note: input.annualSalaryUsd ? `$${input.annualSalaryUsd.toLocaleString()} USD/yr` : 'unspecified',
  });
  const hist = scoreHistory(input.previousVisasApproved, input.previousVisasDenied);
  factors.push({
    key: 'visa_history',
    contribution: hist,
    note: `${input.previousVisasApproved} approved / ${input.previousVisasDenied} denied`,
  });
  const crim = scoreCriminal(input.criminalRecord);
  factors.push({ key: 'criminal_record', contribution: crim, note: input.criminalRecord ? 'present' : 'none' });
  const spon = scoreSponsor(input.sponsorship, input.visaType);
  factors.push({ key: 'sponsorship', contribution: spon, note: input.sponsorship });

  // ─── PolicyOS integration ───────────────────────────────────────────
  const country = await prisma.country.findFirst({
    where: { OR: [{ iso2: input.countryIso.toUpperCase() }, { iso3: input.countryIso.toUpperCase() }] },
    select: { id: true, iso2: true, name: true },
  });

  let immigrationScore: number | null = null;
  let immigrationTrend: VisaAssessment['immigrationTrend'] = 'unknown';
  let policyAdjustment = 0;
  const policyLinks: PolicyLinkage[] = [];

  if (country) {
    const domainScore = await prisma.domainScore.findUnique({
      where: { countryId_domain: { countryId: country.id, domain: 'immigration' } },
    });
    immigrationScore = domainScore?.score ?? null;

    // Recent trend: sum of last 30 days score changes.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentChanges = await prisma.scoreChangeLog.findMany({
      where: { countryId: country.id, domain: 'immigration', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      include: { triggeringPolicy: { select: { id: true, title: true, summary: true, officialSourceUrl: true } } },
      take: 10,
    });
    const totalDelta = recentChanges.reduce((a, c) => a + c.delta, 0);
    if (Math.abs(totalDelta) < 0.5) immigrationTrend = 'stable';
    else if (totalDelta > 0) immigrationTrend = 'liberalising';
    else immigrationTrend = 'tightening';

    // Policy adjustment: score deviation from 50 gives 0..±15 points,
    // recent trend adds up to ±8 points.
    if (immigrationScore != null) {
      policyAdjustment += ((immigrationScore - 50) / 50) * 15;
    }
    policyAdjustment += Math.max(-8, Math.min(8, totalDelta * 2));

    for (const c of recentChanges.slice(0, 4)) {
      if (!c.triggeringPolicy) continue;
      policyLinks.push({
        policyId: c.triggeringPolicy.id,
        title: c.triggeringPolicy.title,
        summary: c.triggeringPolicy.summary,
        sourceUrl: c.triggeringPolicy.officialSourceUrl,
        recentChange: {
          at: c.createdAt.toISOString(),
          delta: Number(c.delta.toFixed(2)),
          direction: c.delta > 0 ? 'liberalising' : c.delta < 0 ? 'tightening' : 'neutral',
        },
      });
    }
  }
  factors.push({ key: 'policy_context', contribution: policyAdjustment, note: `${input.countryIso} immigration score ${immigrationScore?.toFixed(1) ?? '—'} trend ${immigrationTrend}` });

  const total = factors.reduce((a, f) => a + f.contribution, 0);
  const banded = bandFromScore(total);

  // ─── Confidence ─────────────────────────────────────────────────────
  const completeness = inputCompleteness(input);
  const hasPolicyContext = policyLinks.length > 0 && immigrationScore != null;
  let confidence: VerificationConfidence = 'low';
  if (completeness >= 0.8 && hasPolicyContext) confidence = 'high';
  else if (completeness >= 0.6 || hasPolicyContext) confidence = 'medium';

  // ─── Risks ──────────────────────────────────────────────────────────
  const policyUncertainty: 'low' | 'medium' | 'high' = policyLinks.length >= 3
    ? 'high'
    : policyLinks.length >= 1 ? 'medium' : 'low';
  const scrutiny: 'low' | 'medium' | 'high' = immigrationScore == null
    ? 'medium'
    : immigrationScore < 40 ? 'high' : immigrationScore < 60 ? 'medium' : 'low';
  const refusalRisk: 'low' | 'medium' | 'high' = total >= 40 ? 'low' : total >= 10 ? 'medium' : 'high';
  const risks: VisaRiskBreakdown = {
    refusalRisk,
    financialSufficiency: sal.sufficiency,
    policyUncertainty,
    countrySpecificScrutiny: scrutiny,
  };

  // ─── Improvements ───────────────────────────────────────────────────
  const improvements: Array<{ suggestion: string; expectedGain: number }> = [];
  if (input.englishLevel !== 'native' && eng < 10) {
    improvements.push({ suggestion: 'Raise English proficiency (IELTS/TOEFL target: C1 or higher).', expectedGain: 6 });
  }
  if (!input.annualSalaryUsd || sal.c < 6) {
    improvements.push({
      suggestion: input.visaType === 'student' || input.visaType === 'visit'
        ? 'Document financial sufficiency ≥ USD 20,000 equivalent (bank statements, scholarship).'
        : 'Seek an offer ≥ USD 50,000/yr to clear most skilled-worker salary thresholds.',
      expectedGain: 6,
    });
  }
  if (input.sponsorship === 'none' && (input.visaType === 'work' || input.visaType === 'pr')) {
    improvements.push({ suggestion: 'Obtain employer or institutional sponsorship before applying.', expectedGain: 10 });
  }
  if (input.previousVisasDenied > 0) {
    improvements.push({
      suggestion: 'Address prior denials: obtain a detailed refusal letter and remedy the cited issues before re-applying.',
      expectedGain: 4,
    });
  }
  if (immigrationTrend === 'tightening') {
    improvements.push({
      suggestion: `${country?.name ?? input.countryIso} is tightening immigration policy right now — delaying an application to monitor next policy updates may reduce refusal risk.`,
      expectedGain: 4,
    });
  }
  if (input.education === 'none' || input.education === 'highschool') {
    improvements.push({
      suggestion: 'Complete a recognised degree — bachelor+ is standard for most skilled visa categories.',
      expectedGain: 10,
    });
  }

  return {
    band: banded.band,
    bandLabel: banded.label,
    confidence: confidence as 'high' | 'medium' | 'low',
    factors,
    risks,
    improvements: improvements.slice(0, 6),
    policyLinks,
    immigrationScore,
    immigrationTrend,
    disclaimers: DISCLAIMERS,
    generatedAt: new Date().toISOString(),
  };
}
