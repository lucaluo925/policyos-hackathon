/** Pure operator diagnostics. This never reserves, settles or refunds money. */
export function summarizeBudgetLedger(rows: readonly unknown[], capMicroUsd: number, reservationMicroUsd: number) {
  if (!Number.isSafeInteger(capMicroUsd) || capMicroUsd < 1 ||
      !Number.isSafeInteger(reservationMicroUsd) || reservationMicroUsd < 1) {
    throw new Error('Invalid audit limits.');
  }
  let accountedMicroUsd = 0;
  let unsettledReservations = 0;
  let invalidRows = 0;
  for (const value of rows) {
    const row = value as { microUsd?: unknown; capMicroUsd?: unknown; state?: unknown } | null;
    if (!row || typeof row.microUsd !== 'number' || !Number.isSafeInteger(row.microUsd) ||
        row.microUsd < 0 || row.microUsd > reservationMicroUsd || row.capMicroUsd !== capMicroUsd ||
        (row.state !== 'reserved' && row.state !== 'settled') ||
        (row.state === 'reserved' && row.microUsd !== reservationMicroUsd)) {
      invalidRows++;
      continue;
    }
    accountedMicroUsd += row.microUsd;
    if (row.state === 'reserved') unsettledReservations++;
  }
  const complete = rows.length > 0 && invalidRows === 0 && Number.isSafeInteger(accountedMicroUsd);
  // An empty campaign may be a wrong database or ID. Never report it as a reset budget.
  return {
    rowCount: rows.length,
    invalidRows,
    unsettledReservations,
    accountedMicroUsd: complete ? accountedMicroUsd : null,
    remainingMicroUsd: complete ? Math.max(0, capMicroUsd - accountedMicroUsd) : null,
    nextReservationFits: complete ? accountedMicroUsd + reservationMicroUsd <= capMicroUsd : null,
    status: !complete ? 'needs_review' : accountedMicroUsd > capMicroUsd ? 'over_cap' : 'accounted',
  };
}
