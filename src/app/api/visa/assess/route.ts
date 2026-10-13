/**
 * POST /api/visa/assess — deterministic visa probability assessment.
 *
 * Takes a VisaInput body, returns the full VisaAssessment. No legal advice;
 * the response always includes the DISCLAIMERS array and bands rather than
 * exact percentages.
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured } from '@/lib/db';
import { assessVisa, type VisaInput } from '@/lib/visa/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VISA_TYPES = ['student', 'work', 'pr', 'visit', 'family'] as const;
const EDUCATIONS = ['none', 'highschool', 'bachelor', 'master', 'phd'] as const;
const ENGLISH = ['none', 'basic', 'intermediate', 'fluent', 'native'] as const;
const SPONSORS = ['none', 'employer', 'family', 'institutional'] as const;

function normaliseInput(body: unknown): VisaInput | { error: string } {
  if (!body || typeof body !== 'object') return { error: 'Expected JSON body' };
  const b = body as Record<string, unknown>;
  const countryIso = typeof b.countryIso === 'string' ? b.countryIso.toUpperCase() : '';
  if (!countryIso) return { error: 'countryIso required' };
  const visaType = typeof b.visaType === 'string' && (VISA_TYPES as readonly string[]).includes(b.visaType) ? (b.visaType as VisaInput['visaType']) : null;
  if (!visaType) return { error: `visaType must be one of: ${VISA_TYPES.join(', ')}` };
  const education = typeof b.education === 'string' && (EDUCATIONS as readonly string[]).includes(b.education) ? (b.education as VisaInput['education']) : 'bachelor';
  const englishLevel = typeof b.englishLevel === 'string' && (ENGLISH as readonly string[]).includes(b.englishLevel) ? (b.englishLevel as VisaInput['englishLevel']) : 'intermediate';
  const sponsorship = typeof b.sponsorship === 'string' && (SPONSORS as readonly string[]).includes(b.sponsorship) ? (b.sponsorship as VisaInput['sponsorship']) : 'none';
  const toNum = (v: unknown): number => (typeof v === 'number' ? v : typeof v === 'string' ? Number(v) || 0 : 0);
  return {
    countryIso,
    visaType,
    education,
    field: typeof b.field === 'string' ? b.field : undefined,
    yearsExperience: Math.max(0, Math.min(40, toNum(b.yearsExperience))),
    englishLevel,
    annualSalaryUsd: b.annualSalaryUsd != null ? Math.max(0, toNum(b.annualSalaryUsd)) : undefined,
    previousVisasDenied: Math.max(0, Math.min(10, toNum(b.previousVisasDenied))),
    previousVisasApproved: Math.max(0, Math.min(20, toNum(b.previousVisasApproved))),
    criminalRecord: Boolean(b.criminalRecord),
    sponsorship,
  };
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: 'DATABASE_URL not configured; visa engine needs PolicyOS DB access.' },
      { status: 503 },
    );
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const parsed = normaliseInput(body);
  if ('error' in parsed) return NextResponse.json(parsed, { status: 400 });

  const assessment = await assessVisa(parsed);
  return NextResponse.json(assessment);
}
