/** SELECT-only preview. Emits a review packet; never executes its review SQL. */
import { readFile, stat } from 'node:fs/promises';
import { Prisma, PrismaClient } from '@prisma/client';
import { configuredModelBudget, MODEL_BUDGET_ENTITY, MODEL_RESERVATION_MICRO_USD } from '../src/lib/verify/spend';
import { COST_CHECKPOINT_ACTION, prepareCostCheckpoint } from '../src/lib/verify/cost-checkpoint';
import { checkpointReviewSql } from '../src/lib/verify/checkpoint-review-sql';
import { summarizeBudgetLedger } from '../src/lib/verify/budget-audit';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--statement-file' || !process.env.DATABASE_URL) throw new Error('Missing private configuration');
  if ((await stat(args[1])).size > 8192) throw new Error('Statement too large');
  const observation = JSON.parse(await readFile(args[1], 'utf8')) as Record<string, unknown>;
  if (!observation || Array.isArray(observation) ||
      Object.keys(observation).sort().join(',') !== 'asOf,costUsd,periodStart' ||
      !['asOf', 'costUsd', 'periodStart'].every(key => typeof observation[key] === 'string')) throw new Error('Invalid statement');
  const budget = configuredModelBudget();
  const client = new PrismaClient({ log: [] });
  try {
    const packet = await client.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const [{ now }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
      const where = { entityType: MODEL_BUDGET_ENTITY, entityId: budget.id };
      const [rows, prior] = await Promise.all([
        tx.auditLog.findMany({ where: { ...where, actionType: 'model_call_reserved' }, select: { id: true, createdAt: true, newValue: true } }),
        tx.auditLog.count({ where: { ...where, actionType: COST_CHECKPOINT_ACTION } }),
      ]);
      if (prior) throw new Error('Checkpoint already exists');
      const checkpoint = prepareCostCheckpoint(rows, budget.capMicroUsd, MODEL_RESERVATION_MICRO_USD,
        observation as { costUsd: string; asOf: string; periodStart: string }, now);
      return { kind: 'review-only-cost-checkpoint', campaignId: budget.id, checkedAt: now.toISOString(),
        checkpoint, projected: summarizeBudgetLedger(rows.map(row => row.newValue), budget.capMicroUsd,
          MODEL_RESERVATION_MICRO_USD, checkpoint.historicalCostMicroUsd),
        reviewSql: checkpointReviewSql(budget.id, checkpoint),
        limitation: 'No write or provider call. Operator must verify the statement scope, completeness and posting delay before applying. This does not prove all lifetime account costs or judge-access compliance.' };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 15_000 });
    console.log(JSON.stringify(packet, null, 2));
  } finally { await client.$disconnect(); }
}

main().catch(() => {
  console.error('Checkpoint preview unavailable. Privately check the original database, settled ledger and observation. No write, reset or provider call was performed.');
  process.exitCode = 1;
});
