/**
 * Stale policy detection — DB-backed.
 *
 * A policy counts as stale if its `lastVerifiedAt` is older than the
 * threshold (default 30 days) or if it has never been verified. The
 * recommended action is derived from how far past the threshold we are and
 * from the policy's verification confidence.
 *
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
          'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to enable stale detection.',
      },
      { status: 503 },
    );
  }

  try {
    const prisma = getPrisma();
    const checkedAt = new Date().toISOString();
    const now = Date.now();
    const staleCutoffDays = 30;
    const deepCutoffDays = 60;
    const staleCutoff = new Date(now - staleCutoffDays * 24 * 60 * 60 * 1000);

    const [totalPolicies, staleRows] = await Promise.all([
      prisma.policy.count(),
      prisma.policy.findMany({
        where: {
          OR: [{ lastVerifiedAt: null }, { lastVerifiedAt: { lt: staleCutoff } }],
        },
        include: { country: true },
        orderBy: [{ lastVerifiedAt: 'asc' }],
      }),
    ]);

    const stalePolicies = staleRows.map((p) => {
      const daysSinceVerification = p.lastVerifiedAt
        ? Math.floor((now - p.lastVerifiedAt.getTime()) / (24 * 60 * 60 * 1000))
        : -1;
      let recommendedAction: string;
      if (!p.sourceAvailable) {
        recommendedAction = 'find_new_source';
      } else if (daysSinceVerification < 0) {
        recommendedAction = 'initial_verification';
      } else if (daysSinceVerification > deepCutoffDays) {
        recommendedAction = 'deep_verification';
      } else if (p.verificationConfidence === 'low' || p.verificationConfidence === 'unverified') {
        recommendedAction = 'manual_review';
      } else {
        recommendedAction = 'reverify';
      }

      return {
        policyId: p.id,
        title: p.title,
        countryIso: p.country.iso2,
        domain: p.domain,
        status: p.status,
        confidence: p.verificationConfidence,
        lastVerifiedAt: p.lastVerifiedAt?.toISOString() ?? null,
        daysSinceVerification,
        recommendedAction,
      };
    });

    const staleCount = stalePolicies.length;
    const stalePercentage =
      totalPolicies > 0 ? Math.round((staleCount / totalPolicies) * 100 * 10) / 10 : 0;

    return NextResponse.json({
      pipeline: 'stale_detection',
      checkedAt,
      totalPolicies,
      staleCount,
      stalePercentage,
      threshold: { staleDays: staleCutoffDays, deepDays: deepCutoffDays },
      stalePolicies,
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
