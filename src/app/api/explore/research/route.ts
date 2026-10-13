import { NextResponse } from 'next/server';
import { CountryResearchQuotaExceeded, InvalidCountryResearchQuery, parseCountryResearchQuery, researchCountry } from '@/lib/research/country';
import { isTavilyConfigured } from '@/lib/verify/tavily';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (process.env.NEXT_PUBLIC_STATIC_DEMO_MODE === '1') {
    return NextResponse.json({ error: 'Live Tavily search is paused on this public workspace.' }, { status: 503 });
  }
  let body: unknown;
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Choose a valid country and policy domain.' }, { status: 400 });
  }
  const { country, domain, scope } = body as Record<string, unknown>;
  if (typeof country !== 'string' || typeof domain !== 'string') {
    return NextResponse.json({ error: 'Choose a valid country and policy domain.' }, { status: 400 });
  }
  const selectedScope = scope === undefined ? 'public' : scope;
  if (typeof selectedScope !== 'string') {
    return NextResponse.json({ error: 'Choose a valid research scope.' }, { status: 400 });
  }
  try { parseCountryResearchQuery(country, domain, selectedScope); } catch (error) {
    if (error instanceof InvalidCountryResearchQuery) return NextResponse.json({ error: error.message }, { status: 400 });
    throw error;
  }
  if (!isTavilyConfigured()) {
    return NextResponse.json({ error: 'Live country research is not configured.' }, { status: 503 });
  }
  try {
    return NextResponse.json(await researchCountry(country, domain, undefined, selectedScope), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof InvalidCountryResearchQuery) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof CountryResearchQuotaExceeded) {
      return NextResponse.json({ error: error.message }, { status: 429, headers: { 'Retry-After': '86400' } });
    }
    return NextResponse.json({ error: 'Live country research is temporarily unavailable.' }, { status: 503 });
  }
}
