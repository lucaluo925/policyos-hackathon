/** Operator-reviewed historical cost, anchored to unchanged, settled call rows.
 * No provider transport, database writes, credentials or automatic activation.
 */
import { createHash } from 'node:crypto';
import { summarizeBudgetLedger } from './budget-audit';

export const COST_CHECKPOINT_ACTION = 'model_cost_checkpoint';
export function configuredCheckpointRequired() {
  const flag = process.env.VERIFY_MODEL_COST_CHECKPOINT_REQUIRED;
  if (flag === undefined || flag === '' || flag === '0') return false;
  if (flag === '1') return true;
  throw new Error('Invalid checkpoint requirement');
}
export interface CostAnchorRow { id: string; createdAt: Date; newValue: unknown }
export interface CostCheckpoint {
  version: 1;
  capMicroUsd: number;
  providerCostMicroUsd: number;
  historicalCostMicroUsd: number;
  anchorMicroUsd: number;
  anchorCount: number;
  anchorHash: string;
  ledgerThrough: string;
  providerAsOf: string;
  providerPeriodStart: string;
}

function isoTime(value: unknown): number {
  if (typeof value !== 'string') throw new Error('Invalid checkpoint time');
  const time = Date.parse(value);
  if (!Number.isFinite(time) || new Date(time).toISOString() !== value) throw new Error('Invalid checkpoint time');
  return time;
}

function anchor(rows: readonly CostAnchorRow[], cap: number, reservation: number) {
  if (rows.some(row => typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(row.id) ||
      !Number.isFinite(row.createdAt.getTime()))) throw new Error('Invalid anchor row');
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate anchor row');
  const summary = summarizeBudgetLedger(rows.map(row => row.newValue), cap, reservation);
  if (summary.status === 'needs_review' || summary.unsettledReservations) throw new Error('Checkpoint needs a complete settled ledger');
  const ordered = [...rows].sort((a, b) => a.id < b.id ? -1 : Number(a.id > b.id));
  // Canonical form also reproducible in the review SQL; no prompt/source data.
  const text = ordered.map(row => {
    const value = row.newValue as { microUsd: number; state: string; capMicroUsd: number };
    return `${row.id}:${value.microUsd}:${value.state}:${value.capMicroUsd}:${row.createdAt.getTime()}`;
  }).join('\n');
  return { microUsd: summary.accountedMicroUsd!, count: rows.length,
    hash: createHash('sha256').update(text).digest('hex'),
    first: Math.min(...rows.map(row => row.createdAt.getTime())),
    through: Math.max(...rows.map(row => row.createdAt.getTime())) };
}

/** Exact decimal USD parsing, rounded UP to integer microdollars. */
export function observedUsdToMicro(value: string): number {
  if (!/^\d{1,10}(\.\d{1,12})?$/.test(value)) throw new Error('Invalid observed cost');
  const [whole, fraction = ''] = value.split('.');
  const scale = BigInt(10) ** BigInt(fraction.length);
  const result = BigInt(whole) * BigInt(1_000_000) + (BigInt(fraction || '0') * BigInt(1_000_000) + scale - BigInt(1)) / scale;
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Observed cost too large');
  return Number(result);
}

export function prepareCostCheckpoint(rows: readonly CostAnchorRow[], cap: number, reservation: number,
  observation: { costUsd: string; asOf: string; periodStart: string }, now: Date): CostCheckpoint {
  const snapshot = anchor(rows, cap, reservation);
  const asOf = isoTime(observation.asOf), start = isoTime(observation.periodStart);
  if (!Number.isFinite(now.getTime()) || asOf > now.getTime() || asOf < snapshot.through ||
      start > snapshot.first || start > asOf) throw new Error('Provider observation does not cover the settled anchor');
  const provider = observedUsdToMicro(observation.costUsd);
  // Call accounting already includes rounding/headroom. This is a conservative
  // reconciliation adjustment, not a claim that every dollar is an untracked call.
  return { version: 1, capMicroUsd: cap, providerCostMicroUsd: provider,
    historicalCostMicroUsd: Math.max(0, provider - snapshot.microUsd),
    anchorMicroUsd: snapshot.microUsd, anchorCount: snapshot.count, anchorHash: snapshot.hash,
    ledgerThrough: new Date(snapshot.through).toISOString(), providerAsOf: observation.asOf,
    providerPeriodStart: observation.periodStart };
}

/** Absence leaves existing admission unchanged. Once present, it cannot be
 * disabled through environment flags; duplicates/damage/anchor drift stop use.
 */
export function historicalCostFromCheckpoint(rows: readonly CostAnchorRow[], checkpoints: readonly unknown[],
  cap: number, reservation: number, now: Date, required = false): number {
  if (!checkpoints.length) {
    if (required) throw new Error('Required cost checkpoint is missing');
    return 0;
  }
  if (checkpoints.length !== 1) throw new Error('Duplicate cost checkpoint');
  const c = checkpoints[0] as CostCheckpoint | null;
  if (!c || c.version !== 1 || c.capMicroUsd !== cap ||
      ![c.providerCostMicroUsd, c.historicalCostMicroUsd, c.anchorMicroUsd, c.anchorCount].every(value => Number.isSafeInteger(value) && value >= 0) ||
      !c.anchorCount || typeof c.anchorHash !== 'string' || !/^[a-f0-9]{64}$/.test(c.anchorHash)) throw new Error('Invalid cost checkpoint');
  const through = isoTime(c.ledgerThrough), asOf = isoTime(c.providerAsOf), start = isoTime(c.providerPeriodStart);
  if (!Number.isFinite(now.getTime()) || through > asOf || asOf > now.getTime() || start > through) throw new Error('Invalid checkpoint window');
  const snapshot = anchor(rows.filter(row => row.createdAt.getTime() <= through), cap, reservation);
  if (snapshot.count !== c.anchorCount || snapshot.microUsd !== c.anchorMicroUsd || snapshot.hash !== c.anchorHash ||
      snapshot.through !== through || start > snapshot.first ||
      c.historicalCostMicroUsd !== Math.max(0, c.providerCostMicroUsd - c.anchorMicroUsd)) throw new Error('Cost anchor changed');
  return c.historicalCostMicroUsd;
}
