/**
 * Contributions API — POST accepts a user submission, GET lists them.
 *
 * Writes go to Prisma (see src/lib/db/repositories/contributions.ts). Every
 * new contribution also creates a ReviewQueueItem with targetType='contribution'
 * and an AuditLog entry. All three writes are independent but ordered so the
 * review UI sees a complete record.
 *
 * When DATABASE_URL is not set, returns 503 rather than silently persisting
 * nowhere. V3 treats no-DB as a production misconfiguration.
 */

import { privateJson } from '@/lib/auth/private-response';
import { isAdminRequest } from '@/lib/auth/admin';
import type { Domain, ContributionStatus } from '@prisma/client';
import {
  isDatabaseConfigured,
  contributionRepo,
  reviewRepo,
  auditRepo,
} from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_DOMAINS: Domain[] = ['climate', 'trade', 'immigration'];

function dbUnavailableResponse() {
  return privateJson(
    {
      error:
        'DATABASE_URL not configured. Provision Postgres via Vercel Marketplace to enable contributions.',
    },
    { status: 503 },
  );
}

export async function GET(request: Request) {
  // Submission content is private; identity is omitted from this list API.
  if (!(await isAdminRequest(request))) {
    return privateJson({ error: 'unauthorized' }, { status: 401 });
  }
  if (!isDatabaseConfigured()) return dbUnavailableResponse();

  try {
    const { searchParams } = new URL(request.url);
    const statusParam = searchParams.get('status');
    const validStatus: ContributionStatus[] = [
      'submitted',
      'under_review',
      'accepted',
      'rejected',
      'merged',
    ];
    const status =
      statusParam && validStatus.includes(statusParam as ContributionStatus)
        ? (statusParam as ContributionStatus)
        : undefined;

    const items = await contributionRepo.listContributions(
      status ? { status } : undefined,
    );
    // Country rows carry BigInt columns (population, GDP) that JSON can't encode.
    return privateJson(
      items.map(c => ({
        id: c.id, contributionType: c.contributionType, countryId: c.countryId, domain: c.domain,
        title: c.title, body: c.body, sourceUrl: c.sourceUrl, status: c.status,
        createdAt: c.createdAt, updatedAt: c.updatedAt,
        country: c.country ? { iso2: c.country.iso2, name: c.country.name } : null,
      })),
    );
  } catch {
    return privateJson(
      {
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return dbUnavailableResponse();

  try {
    const body = await request.json();

    // Accept both the legacy client shape `{ type, country, category, title,
    // description, sourceUrl, email }` and the more direct new shape
    // `{ contributionType, countryIso, domain, title, body, sourceUrl, ... }`.
    // The UI today sends the legacy shape.
    const contributionType = body.contributionType ?? body.type;
    const countryIso = body.countryIso ?? body.country;
    const domain: Domain | undefined = (body.domain ?? body.category) as Domain | undefined;
    const title = body.title;
    const messageBody = body.body ?? body.description;
    const sourceUrl = body.sourceUrl;
    const submitterName = body.submitterName ?? body.name ?? null;
    const submitterEmail = body.submitterEmail ?? body.email ?? null;

    const missing: string[] = [];
    if (!contributionType) missing.push('type');
    if (!countryIso) missing.push('country');
    if (!domain) missing.push('category');
    if (!title) missing.push('title');
    if (!messageBody) missing.push('description');
    if (!sourceUrl) missing.push('sourceUrl');
    if (missing.length) {
      return privateJson(
        { error: `Missing required field(s): ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    if (!VALID_DOMAINS.includes(domain as Domain)) {
      return privateJson(
        { error: `Invalid category '${domain}'. Must be one of: ${VALID_DOMAINS.join(', ')}` },
        { status: 400 },
      );
    }

    const contribution = await contributionRepo.createContribution({
      contributionType,
      countryIso,
      domain: domain as Domain,
      title,
      body: messageBody,
      sourceUrl,
      submitterName,
      submitterEmail,
    });

    // Every contribution immediately lands in the review queue so admins can
    // triage it. Confidence defaults to unverified.
    const reviewItem = await reviewRepo.createReviewItem({
      targetType: 'contribution',
      targetId: contribution.id,
      contributionId: contribution.id,
      priority: 3,
      confidence: 'unverified',
      recommendedAction: 'triage',
      summary: title,
    });

    // Audit log for traceability. Anonymous submissions are tagged as such;
    // the email remains only on the private Contribution row, never copied here.
    await auditRepo.append({
      entityType: 'contribution',
      entityId: contribution.id,
      actionType: 'contribution_received',
      actorType: 'user',
      actorId: 'anonymous',
      confidence: 'unverified',
      sourceUrl,
      summary: `User contribution: ${title}`,
      newValue: {
        contributionType,
        countryIso,
        domain,
        title,
      },
    });

    return privateJson(
      {
        success: true,
        id: contribution.id,
        createdAt: contribution.createdAt,
        reviewItemId: reviewItem.id,
      },
      { status: 201 },
    );
  } catch {
    return privateJson(
      {
        error: 'Internal server error',
      },
      { status: 500 },
    );
  }
}
