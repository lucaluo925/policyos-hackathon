import { Prisma, type PrismaClient } from '@prisma/client';
import { getPrisma, isDatabaseConfigured } from '@/lib/db/client';
import { configuredVerificationRunCap } from './admission';
import { configuredModelBudget, MODEL_BUDGET_ENTITY, MODEL_RESERVATION_MICRO_USD, type ModelBudget } from './spend';
import { availabilityFromSnapshot, type VerificationAvailability } from './availability';

/** SELECT-only, consistent database-time snapshot. No reservations or provider calls. */
export async function readSharedVerificationAvailability(
  client: PrismaClient, runCap: number, assertionCap: number, budget?: ModelBudget,
): Promise<VerificationAvailability> {
  return client.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
    const since = new Date(now.getTime() - 86_400_000);
    const base = { entityType: 'claim_verification', createdAt: { gte: since } };
    const [runs, assertions, ledger] = await Promise.all([
      tx.auditLog.findMany({ where: { ...base, actionType: 'verify_run_reserved' }, select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: runCap }),
      tx.auditLog.findMany({ where: { ...base, actionType: 'claim_verified' }, select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: assertionCap }),
      budget ? tx.auditLog.findMany({ where: { entityType: MODEL_BUDGET_ENTITY, entityId: budget.id, actionType: 'model_call_reserved' }, select: { newValue: true } }) : [],
    ]);
    return availabilityFromSnapshot({ now, runCap, assertionCap,
      runDates: runs.map(row => row.createdAt), assertionDates: assertions.map(row => row.createdAt),
      budget: budget ? { ...budget, reservationMicroUsd: MODEL_RESERVATION_MICRO_USD, rows: ledger.map(row => row.newValue) } : undefined,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 5_000 });
}

export async function getVerificationAvailability(): Promise<VerificationAvailability> {
  const checkedAt = new Date().toISOString();
  if (process.env.NEXT_PUBLIC_STATIC_DEMO_MODE === '1') return { status: 'paused', checkedAt };
  if (!process.env.NEBIUS_API_KEY || !process.env.TAVILY_API_KEY) return { status: 'unavailable', checkedAt };
  try {
    const required = process.env.VERCEL === '1' || process.env.VERIFY_REQUIRE_SHARED_QUOTA === '1';
    const needsBudget = required || Boolean(process.env.VERIFY_MODEL_BUDGET_ID);
    const expiresAt = Date.parse(process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT ?? '');
    if (needsBudget && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      return { status: 'expired', checkedAt, budgetExpiresAt: new Date(expiresAt).toISOString() };
    }
    const runCap = configuredVerificationRunCap();
    const assertionCap = Number(process.env.VERIFY_DAILY_ASSERTION_CAP ?? 12);
    if (!Number.isSafeInteger(assertionCap) || assertionCap < 1) throw new Error('Invalid assertion cap');
    if (!isDatabaseConfigured()) return { status: required || needsBudget ? 'unavailable' : 'available', checkedAt };
    const budget = needsBudget ? configuredModelBudget() : undefined;
    return await readSharedVerificationAvailability(getPrisma(), runCap, assertionCap, budget);
  } catch { return { status: 'unavailable', checkedAt }; }
}
