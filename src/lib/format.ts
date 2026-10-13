/**
 * Shared numeric formatters for consistent display across the app.
 *
 * GDP values in our data are stored in millions of USD (e.g. 27360000 = $27.36T).
 * Population values are raw counts (e.g. 334914895).
 */

export function formatGDP(millionsUsd: number): string {
  if (millionsUsd >= 1_000_000) {
    return `$${(millionsUsd / 1_000_000).toFixed(2)}T`;
  }
  if (millionsUsd >= 1_000) {
    return `$${(millionsUsd / 1_000).toFixed(0)}B`;
  }
  return `$${millionsUsd}M`;
}

export function formatPopulation(pop: number): string {
  if (pop >= 1_000_000_000) {
    return `${(pop / 1_000_000_000).toFixed(2)}B`;
  }
  if (pop >= 1_000_000) {
    return `${(pop / 1_000_000).toFixed(1)}M`;
  }
  if (pop >= 1_000) {
    return `${(pop / 1_000).toFixed(0)}K`;
  }
  return String(pop);
}

export function formatScore(value: number): string {
  return String(Math.round(value));
}

export function formatCarbonPrice(usdPerTon: number): string {
  if (usdPerTon === 0) return '$0/ton';
  return `$${usdPerTon}/ton`;
}

export function formatPercent(value: number): string {
  return `${Math.round(value)}%`;
}

export function formatMetricValue(value: number, unit: string): string {
  if (unit === '$/ton') return formatCarbonPrice(value);
  if (unit === '/100') return `${formatScore(value)}/100`;
  if (unit === 'percent') return formatPercent(value);
  return formatScore(value);
}
