/** Shared campaign budget, separate from the rolling run limit.
 * Rates verified 2026-10-13: Super $0.30/$0.90, Ultra $1/$3 per million
 * input/output tokens. Reserve a full 1,048,576-token context plus 8,192
 * output tokens at the higher rate, with 25% headroom, rounded up to $1.50.
 * This is application accounting, not a provider-enforced billing ceiling.
 */
import { summarizeBudgetLedger } from './budget-audit';
import { COST_CHECKPOINT_ACTION, configuredCheckpointRequired, historicalCostFromCheckpoint } from './cost-checkpoint';
import { Prisma } from '@prisma/client';
import { getPrisma } from '@/lib/db';
import { MODEL_ADJUDICATOR, MODEL_DECOMPOSER } from './nemotron';

export const MODEL_RESERVATION_MICRO_USD = 1_500_000;
export const MODEL_BUDGET_ENTITY = 'verification_model_budget';
const ACTION = 'model_call_reserved';
const MODEL_URL = 'https://api.tokenfactory.nebius.com/v1/chat/completions';
export class ModelBudgetStopped extends Error {}
export interface ModelBudget { id: string; capMicroUsd: number; expiresAt: number }

export function configuredModelBudget(): ModelBudget {
  const id = process.env.VERIFY_MODEL_BUDGET_ID ?? '';
  const dollars = process.env.VERIFY_MODEL_BUDGET_USD ?? '';
  const expiresAt = Date.parse(process.env.VERIFY_MODEL_BUDGET_EXPIRES_AT ?? '');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id) || !/^\d+(\.\d{1,2})?$/.test(dollars)) {
    throw new ModelBudgetStopped('Live verification budget is not configured.');
  }
  const capMicroUsd = Math.round(Number(dollars) * 1_000_000);
  if (!Number.isSafeInteger(capMicroUsd) || capMicroUsd < MODEL_RESERVATION_MICRO_USD ||
      !Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    throw new ModelBudgetStopped('Live verification budget needs operator review.');
  }
  return { id, capMicroUsd, expiresAt };
}

export interface BudgetStore {
  reserve(budget: ModelBudget): Promise<string>;
  settle(id: string, microUsd: number): Promise<void>;
}

export const sharedModelBudgetStore: BudgetStore = {
  async reserve(budget) {
    if (!Number.isSafeInteger(budget.capMicroUsd) || budget.capMicroUsd < MODEL_RESERVATION_MICRO_USD ||
        !Number.isFinite(budget.expiresAt) || budget.expiresAt <= Date.now()) {
      throw new ModelBudgetStopped('Invalid or expired model budget.');
    }
    for (let attempt = 0; ; attempt++) {
      try {
        return await getPrisma().$transaction(async tx => {
          const where = { entityType: MODEL_BUDGET_ENTITY, entityId: budget.id };
          const [rows, checkpoints, [{ now }]] = await Promise.all([
            tx.auditLog.findMany({ where: { ...where, actionType: ACTION }, select: { id: true, createdAt: true, newValue: true } }),
            tx.auditLog.findMany({ where: { ...where, actionType: COST_CHECKPOINT_ACTION }, select: { newValue: true } }),
            tx.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`,
          ]);
          let historicalCost: number;
          try {
            historicalCost = historicalCostFromCheckpoint(rows, checkpoints.map(row => row.newValue), budget.capMicroUsd, MODEL_RESERVATION_MICRO_USD, now, configuredCheckpointRequired());
          } catch { throw new ModelBudgetStopped('Live verification cost checkpoint needs review.'); }
          const report = summarizeBudgetLedger(rows.map(row => row.newValue), budget.capMicroUsd, MODEL_RESERVATION_MICRO_USD, historicalCost);
          // Initial private store initialization remains supported; the hosted
          // availability gate already refuses an empty campaign. A checkpoint
          // cannot be carried into an empty/reset ledger.
          const initialEmpty = rows.length === 0 && checkpoints.length === 0;
          if (now.getTime() >= budget.expiresAt || (!initialEmpty && (report.status !== 'accounted' || !report.nextReservationFits))) {
            throw new ModelBudgetStopped('Live verification budget is exhausted or needs review.');
          }
          const row = await tx.auditLog.create({ data: {
            entityType: MODEL_BUDGET_ENTITY, entityId: budget.id, actionType: ACTION,
            actorType: 'system', summary: 'Model cost reserved before provider request',
            newValue: { microUsd: MODEL_RESERVATION_MICRO_USD,
              capMicroUsd: budget.capMicroUsd, state: 'reserved', rateDate: '2026-10-13' },
          }, select: { id: true } });
          return row.id;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 });
      } catch (error) {
        if ((error as { code?: string })?.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
  },
  async settle(id, microUsd) {
    if (!Number.isSafeInteger(microUsd) || microUsd < 0 || microUsd > MODEL_RESERVATION_MICRO_USD) {
      throw new ModelBudgetStopped('Invalid model usage; reservation retained.');
    }
    await getPrisma().$transaction(async tx => {
      const row = await tx.auditLog.findUniqueOrThrow({ where: { id } });
      const record = row.newValue as Prisma.JsonObject | null;
      if (row.entityType !== MODEL_BUDGET_ENTITY || row.actionType !== ACTION || record?.state !== 'reserved') {
        throw new ModelBudgetStopped('Invalid budget settlement.');
      }
      await tx.auditLog.update({ where: { id }, data: {
        newValue: { ...record, microUsd, state: 'settled' },
      } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 5_000 });
  },
};

/** The returned transport stops the entire run on a ledger error. Failed or
 * disconnected requests retain the full reservation, even if upstream billed.
 * No credentials, prompts, or evidence text are written to this ledger. */
export function budgetedModelFetch(budget: ModelBudget, abort: AbortController,
  transport: typeof fetch = fetch, store: BudgetStore = sharedModelBudgetStore): typeof fetch {
  return async (input, init) => {
    abort.signal.throwIfAborted();
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== MODEL_URL) {
      if (new URL(url).hostname.endsWith('nebius.com')) {
        const error = new ModelBudgetStopped('Unapproved model endpoint.');
        abort.abort(error); throw error;
      }
      return transport(input, init);
    }
    try {
      if (init?.method !== 'POST' || typeof init.body !== 'string' || Buffer.byteLength(init.body) > 131_072) {
        throw new ModelBudgetStopped('Unbounded model request.');
      }
      const body = JSON.parse(init.body);
      if (![MODEL_DECOMPOSER, MODEL_ADJUDICATOR].includes(body.model) || body.stream === true ||
          (body.n !== undefined && body.n !== 1) || !Number.isSafeInteger(body.max_tokens) ||
          body.max_tokens < 1 || body.max_tokens > 8192) {
        throw new ModelBudgetStopped('Unapproved model or output limit.');
      }
      const id = await store.reserve(budget);
      abort.signal.throwIfAborted();
      const response = await transport(input, init);
      if (!response.ok) return response; // Preserve full reservation on failure.
      const result = await response.clone().json();
      const prompt = result?.usage?.prompt_tokens, completion = result?.usage?.completion_tokens;
      if (!Number.isSafeInteger(prompt) || prompt < 1 || prompt > 1_048_576 ||
          !Number.isSafeInteger(completion) || completion < 1 || completion > body.max_tokens) {
        throw new ModelBudgetStopped('Model usage unavailable; reservation retained.');
      }
      const ultra = body.model === MODEL_ADJUDICATOR;
      // Integer microdollars, rounded upward; completion includes reasoning.
      const microUsd = Math.ceil((prompt * (ultra ? 1 : 0.3) + completion * (ultra ? 3 : 0.9)) * 1.25);
      await store.settle(id, microUsd);
      return response;
    } catch (error) {
      // Prevent pipeline recovery paths from issuing more metered requests.
      const stopped = error instanceof ModelBudgetStopped ? error :
        new ModelBudgetStopped('Live verification budget accounting is unavailable.');
      abort.abort(stopped);
      throw stopped;
    }
  };
}
