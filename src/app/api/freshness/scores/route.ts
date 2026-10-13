/**
 * Domain scores snapshot — DB-backed.
 *
 * Reads every country's current DomainScore, active policy counts, and
 * recent score change count. This is the read-only summary consumed by
 * dashboards; score recomputation itself happens inside the scoring engine
 * triggered by pipeline runs or reviewer actions.
 *
 * Optional query parameter: `?country=<iso>` to scope to one country.
 * Protected by CRON_SECRET when set.
 */

import { NextResponse } from 'next/server';
import { isDatabaseConfigured, getPrisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function verifyAuth(request: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return process.env.NODE_ENV !== 'production';
  const authHeader = request.headers.get('authorization');
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request) {
  if (!verifyAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      {
        error:
          'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to read scores.',
      },
      { status: 503 },
    );
  }

  try {
    const prisma = getPrisma();
    const { searchParams } = new URL(request.url);
    const isoFilter = searchParams.get('country')?.toUpperCase();

    const countries = await prisma.country.findMany({
      where: isoFilter
        ? { OR: [{ iso2: isoFilter }, { iso3: isoFilter }] }
        : undefined,
      include: {
        domainScores: true,
        policies: {
          select: { id: true, status: true, domain: true, verificationConfidence: true },
        },
        scoreChangeLogs: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true, domain: true, delta: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    const computedAt = new Date().toISOString();

    const countryData = countries.map((country) => {
      const scoresByDomain: Record<string, number | null> = {
        climate: null,
        trade: null,
        immigration: null,
      };
      for (const ds of country.domainScores) {
        scoresByDomain[ds.domain] = Number(ds.score.toFixed(2));
      }

      const totalCount = country.policies.length;
      const activeCount = country.policies.filter((p) => p.status === 'active').length;
      const suspendedOrRepealed = country.policies.filter(
        (p) => p.status === 'suspended' || p.status === 'expired' || p.status === 'repealed',
      ).length;
      const lowConfidence = country.policies.filter(
        (p) => p.verificationConfidence === 'low' || p.verificationConfidence === 'unverified',
      ).length;
      const flagged =
        (totalCount > 0 && suspendedOrRepealed / totalCount > 0.25) || lowConfidence > 0;

      return {
        iso: country.iso2,
        iso3: country.iso3,
        name: country.name,
        activeCount,
        totalCount,
        suspendedOrRepealed,
        lowConfidence,
        flagged,
        currentScores: scoresByDomain,
        lastScoreChange: country.scoreChangeLogs[0]
          ? {
              at: country.scoreChangeLogs[0].createdAt.toISOString(),
              domain: country.scoreChangeLogs[0].domain,
              delta: Number(country.scoreChangeLogs[0].delta.toFixed(2)),
            }
          : null,
      };
    });

    return NextResponse.json({
      pipeline: 'score_snapshot',
      computedAt,
      methodologyVersion: '1.0',
      countryCount: countryData.length,
      countries: countryData,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
