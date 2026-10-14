import { summarizeBudgetLedger } from './budget-audit';

const DAY_MS = 86_400_000;
export type VerificationAvailabilityStatus = 'available' | 'daily_limit' | 'budget_limit' | 'expired' | 'paused' | 'unavailable' | 'judge_required';
/** Public application status only. Never expose ledger rows, amounts, IDs or credentials. */
export interface VerificationAvailability {
  status: VerificationAvailabilityStatus;
  checkedAt: string;
  retryAt?: string;
  budgetExpiresAt?: string;
}
export interface AvailabilitySnapshot {
  now: Date;
  runCap: number;
  assertionCap: number;
  runDates: Date[];
  assertionDates: Date[];
  budget?: { capMicroUsd: number; expiresAt: number; reservationMicroUsd: number; rows: unknown[]; historicalCostMicroUsd?: number };
}

function nextSlot(dates: Date[], cap: number, now: number): number | null {
  const active = dates.map(date => date.getTime());
  if (active.some(value => !Number.isFinite(value) || value > now)) throw new Error('Invalid quota time');
  const ordered = active.filter(value => value >= now - DAY_MS).sort((a, b) => b - a);
  // Count uses gte, so the boundary row expires one millisecond after 24 hours.
  return ordered.length >= cap ? ordered[cap - 1] + DAY_MS + 1 : null;
}

/** Advisory only; atomic admission and per-call model reservation remain authoritative. */
export function availabilityFromSnapshot(snapshot: AvailabilitySnapshot): VerificationAvailability {
  const now = snapshot.now.getTime();
  if (!Number.isFinite(now)) throw new Error('Invalid check time');
  const result: VerificationAvailability = { status: 'available', checkedAt: snapshot.now.toISOString() };
  try {
    if (![snapshot.runCap, snapshot.assertionCap].every(cap => Number.isSafeInteger(cap) && cap > 0)) throw new Error('Invalid quota');
    if (snapshot.budget) {
      const budget = snapshot.budget;
      if (!Number.isFinite(budget.expiresAt)) throw new Error('Invalid expiry');
      result.budgetExpiresAt = new Date(budget.expiresAt).toISOString();
      if (budget.expiresAt <= now) return { ...result, status: 'expired' };
      const ledger = summarizeBudgetLedger(budget.rows, budget.capMicroUsd, budget.reservationMicroUsd, budget.historicalCostMicroUsd);
      if (ledger.status === 'needs_review') return { ...result, status: 'unavailable' };
      if (!ledger.nextReservationFits) return { ...result, status: 'budget_limit' };
    }
    const waits = [nextSlot(snapshot.runDates, snapshot.runCap, now), nextSlot(snapshot.assertionDates, snapshot.assertionCap, now)];
    const retry = Math.max(...waits.map(value => value ?? 0));
    if (!retry) return result;
    // Do not advertise a retry after the authorized access window has ended.
    if (snapshot.budget && retry >= snapshot.budget.expiresAt) return { ...result, status: 'daily_limit' };
    return { ...result, status: 'daily_limit', retryAt: new Date(retry).toISOString() };
  } catch { return { status: 'unavailable', checkedAt: result.checkedAt }; }
}

export function verificationAccessFailure(status: VerificationAvailability) {
  if (status.status === 'available') return null;
  const messages: Record<Exclude<VerificationAvailabilityStatus, 'available'>, string> = {
    judge_required: 'Sign in at the judge testing entrance before starting a live request.',
    daily_limit: 'Live verification is at its shared rolling 24-hour limit. Check availability again before retrying.',
    budget_limit: 'Live verification is stopped by the project model spending limit. Operator review is required.',
    expired: 'The live verification access period has ended. Operator review is required.',
    paused: 'Live verification is paused. Dated recorded runs remain available.',
    unavailable: 'Shared live verification limit or model budget is unavailable. No live run was admitted; please try again later.',
  };
  const retryAfterSeconds = status.retryAt
    ? Math.max(1, Math.ceil((Date.parse(status.retryAt) - Date.parse(status.checkedAt)) / 1000)) : undefined;
  let httpStatus = 503;
  if (status.status === 'daily_limit') httpStatus = 429;
  else if (status.status === 'judge_required') httpStatus = 401;
  return { error: messages[status.status], code: status.status, httpStatus,
    retryAt: status.retryAt, retryAfterSeconds };
}
