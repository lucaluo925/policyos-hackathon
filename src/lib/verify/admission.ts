/** Reserve a live verifier run before any metered model or search call.
 *
 * Completed-assertion audit rows miss failed and disconnected runs. A separate
 * Serializable reservation counts attempts, including ones that later fail.
 * It is a run ceiling, not a provider billing ceiling or a promise of uptime.
 */
import { Prisma } from '@prisma/client';
import { getPrisma } from '@/lib/db';

const ENTITY_TYPE = 'claim_verification';
const ACTION_TYPE = 'verify_run_reserved';
const DEFAULT_DAILY_RUN_CAP = 12;
const DAY_MS = 24 * 60 * 60 * 1000;

export class VerificationRunQuotaExceeded extends Error {}

export function configuredVerificationRunCap(): number {
  const cap = Number(process.env.VERIFY_DAILY_RUN_CAP ?? DEFAULT_DAILY_RUN_CAP);
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('VERIFY_DAILY_RUN_CAP must be a positive integer');
  return cap;
}

interface QuotaTransaction {
  count(since: Date): Promise<number>;
  reserve(day: string): Promise<void>;
}

export type VerificationQuotaRunner = (work: (tx: QuotaTransaction) => Promise<void>) => Promise<void>;

async function runPrismaQuotaTransaction(work: (tx: QuotaTransaction) => Promise<void>) {
  await getPrisma().$transaction(async tx => {
    await work({
      count: since => tx.auditLog.count({ where: {
        entityType: ENTITY_TYPE, actionType: ACTION_TYPE, createdAt: { gte: since },
      } }),
      reserve: async day => {
        await tx.auditLog.create({ data: {
          entityType: ENTITY_TYPE, entityId: day, actionType: ACTION_TYPE,
          actorType: 'system', summary: 'Reserved one bounded live verification run',
        } });
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 });
}

/** A reservation is never refunded: the upstream may have billed before a
 * disconnect or error. Serialization conflicts are retried, other database
 * failures propagate so hosted routes can fail closed before paid calls. */
export async function reserveSharedVerificationRun(
  now: Date = new Date(),
  cap = configuredVerificationRunCap(),
  run: VerificationQuotaRunner = runPrismaQuotaTransaction,
): Promise<void> {
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('Invalid verification run cap');
  const since = new Date(now.getTime() - DAY_MS);
  const day = now.toISOString().slice(0, 10);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await run(async tx => {
        if (await tx.count(since) >= cap) {
          throw new VerificationRunQuotaExceeded('Daily live verification run limit reached.');
        }
        await tx.reserve(day);
      });
      return;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}
