/** Run with an existing operator-provided environment; never loads or writes a secret file. */
import { Prisma, PrismaClient } from '@prisma/client';
import { configuredModelBudget, MODEL_RESERVATION_MICRO_USD, MODEL_BUDGET_ENTITY } from '../src/lib/verify/spend';
import { configuredVerificationRunCap } from '../src/lib/verify/admission';
import { summarizeBudgetLedger } from '../src/lib/verify/budget-audit';

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('missing configuration');
  const budget = configuredModelBudget();
  const runCap = configuredVerificationRunCap();
  const assertionCap = Number(process.env.VERIFY_DAILY_ASSERTION_CAP ?? 12);
  if (!Number.isSafeInteger(assertionCap) || assertionCap < 1) throw new Error('invalid assertion cap');
  // Disable Prisma logging: connection errors must not print credentials/host details.
  const client = new PrismaClient({ log: [] });
  try {
    const report = await client.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
      const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const rows = await tx.auditLog.findMany({ where: {
        entityType: MODEL_BUDGET_ENTITY, entityId: budget.id, actionType: 'model_call_reserved',
      }, select: { newValue: true } });
      const runs = await tx.auditLog.count({ where: {
        entityType: 'claim_verification', actionType: 'verify_run_reserved', createdAt: { gte: since },
      } });
      const assertions = await tx.auditLog.count({ where: {
        entityType: 'claim_verification', actionType: 'claim_verified', createdAt: { gte: since },
      } });
      return {
        checkedAt: now.toISOString(), campaignId: budget.id,
        expiresAt: new Date(budget.expiresAt).toISOString(),
        expiredAtDatabaseTime: budget.expiresAt <= now.getTime(),
        capMicroUsd: budget.capMicroUsd,
        ledger: summarizeBudgetLedger(rows.map(row => row.newValue), budget.capMicroUsd, MODEL_RESERVATION_MICRO_USD),
        rolling24Hours: { runs, runCap, assertions, assertionCap },
        staticDemo: process.env.NEXT_PUBLIC_STATIC_DEMO_MODE === '1',
        limitation: 'Read-only snapshot, not a reservation, provider balance, invoice, or judging-access guarantee. Known out-of-ledger costs remain separate. No provider calls made.',
      };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
    console.log(JSON.stringify(report, null, 2));
    if (report.ledger.status !== 'accounted' || !report.ledger.nextReservationFits ||
        report.expiredAtDatabaseTime || report.staticDemo ||
        report.rolling24Hours.runs >= runCap || report.rolling24Hours.assertions >= assertionCap) process.exitCode = 2;
  } finally {
    await client.$disconnect();
  }
}

main().catch(() => {
  console.error('Budget audit unavailable. Check the existing database access and budget configuration privately. No reservation, reset, migration, or provider call was performed.');
  process.exitCode = 1;
});
