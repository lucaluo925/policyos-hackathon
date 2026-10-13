import { isAdminRequest } from '@/lib/auth/admin';
import { privateJson } from '@/lib/auth/private-response';
import { getPrisma, isDatabaseConfigured } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A record ID is a locator, not authorization. Only an authenticated reviewer
 * can download saved excerpts. No cron-secret or anonymous-ID bypass. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await isAdminRequest(request))) return privateJson({ error: 'unauthorized' }, { status: 401 });
  const { id } = await context.params;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return privateJson({ error: 'Invalid record ID.' }, { status: 400 });
  if (!isDatabaseConfigured()) return privateJson({ error: 'Evidence storage is unavailable.' }, { status: 503 });
  try {
    const record = await getPrisma().verificationRun.findUnique({
      where: { id }, select: { id: true, createdAt: true, snapshot: true },
    });
    if (!record) return privateJson({ error: 'Saved evidence not found.' }, { status: 404 });
    return privateJson({ id: record.id, savedAt: record.createdAt, snapshot: record.snapshot }, {
      headers: {
        'Content-Disposition': `attachment; filename="policyos-evidence-${id}.json"`,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return privateJson({ error: 'Could not load saved evidence.' }, { status: 500 });
  }
}
