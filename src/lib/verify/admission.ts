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

/** Judge testing allowance (separate from the public rolling 24-hour cap).
 *
 * A signed-in judge session is not subject to the public daily run cap. The
 * metered Tavily path still needs a hard ceiling: Tavily pay-as-you-go is
 * enabled, and the model budget does not price search credits. A judge run is
 * therefore reserved against a fixed campaign allowance (all judge runs for one
 * model-budget campaign, no rolling reset), before any provider call. The
 * model budget ledger and expiry still apply per model call.
 *
 * Credit bound: a run makes at most 6 Tavily calls (pipeline tavilyBudget);
 * a scoped official search is 'advanced' (2 credits) and Extract takes at most
 * 3 URLs (1 basic credit), so one run is at most 12 credits and the campaign
 * at most VERIFY_JUDGE_RUN_CAP x 12. The allowance is keyed to
 * VERIFY_MODEL_BUDGET_ID: changing that ID starts a new allowance and must not
 * be used to obtain fresh capacity (see README budget-audit notes).
 */
const JUDGE_ACTION_TYPE = 'verify_run_reserved_judge';
export const JUDGE_RUN_ENTITY = 'claim_verification_judge';
export class JudgeRunAllowanceExhausted extends Error {}

/** Required: no default, so a missing setting fails closed instead of spending. */
export function configuredJudgeRunCap(): number {
  const cap = Number(process.env.VERIFY_JUDGE_RUN_CAP ?? '');
  if (!Number.isSafeInteger(cap) || cap < 1 || cap > 1_000) {
    throw new Error('VERIFY_JUDGE_RUN_CAP must be an integer from 1 to 1000');
  }
  return cap;
}

interface JudgeQuotaTransaction {
  count(): Promise<number>;
  reserve(): Promise<void>;
}
export type JudgeQuotaRunner = (work: (tx: JudgeQuotaTransaction) => Promise<void>) => Promise<void>;

function prismaJudgeQuotaTransaction(campaign: string): JudgeQuotaRunner {
  return async work => {
    await getPrisma().$transaction(async tx => {
      await work({
        count: () => tx.auditLog.count({ where: {
          entityType: JUDGE_RUN_ENTITY, entityId: campaign, actionType: JUDGE_ACTION_TYPE,
        } }),
        reserve: async () => {
          await tx.auditLog.create({ data: {
            entityType: JUDGE_RUN_ENTITY, entityId: campaign, actionType: JUDGE_ACTION_TYPE,
            actorType: 'system', summary: 'Reserved one judge-session live verification run',
          } });
        },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 });
  };
}

/** Audit action name of a judge reservation; availability counts these read-only. */
export const JUDGE_RUN_ACTION = JUDGE_ACTION_TYPE;

/** Never refunded, like the public reservation. Database failure propagates. */
export async function reserveJudgeVerificationRun(
  campaign: string,
  cap = configuredJudgeRunCap(),
  run: JudgeQuotaRunner = prismaJudgeQuotaTransaction(campaign),
): Promise<void> {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(campaign)) throw new Error('Invalid judge allowance campaign');
  if (!Number.isSafeInteger(cap) || cap < 1) throw new Error('Invalid judge run cap');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await run(async tx => {
        if (await tx.count() >= cap) {
          throw new JudgeRunAllowanceExhausted('Judge testing allowance for this campaign is used up.');
        }
        await tx.reserve();
      });
      return;
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2034' && attempt < 2) continue;
      throw error;
    }
  }
}
