export interface CountryMetrics {
  iso: string;
  climate: {
    carbonPolicyStrength: number;
    climateActionAlignment: number;
    effectiveCarbonPrice: number; // USD/ton
  };
  trade: {
    tradeOpennessIndex: number;
    tradeProtectionIndex: number;
    sanctionExposure: number;
  };
  immigration: {
    immigrationOpenness: number;
    borderControlIntensity: number;
    visaFreedomGranted: number;
  };
}

export type CategoryKey = 'climate' | 'trade' | 'immigration';

export interface MetricDefinition {
  slug: string;
  name: string;
  category: CategoryKey;
  unit: string;
  direction: 'higher_better' | 'lower_better' | 'neutral';
  description: string;
}

export const metricDefinitions: MetricDefinition[] = [
  { slug: 'carbonPolicyStrength', name: 'Carbon Policy Strength', category: 'climate', unit: '/100', direction: 'higher_better', description: 'Composite score of carbon pricing, emission targets, and renewable mandates' },
  { slug: 'climateActionAlignment', name: 'Climate Action Alignment', category: 'climate', unit: '/100', direction: 'higher_better', description: 'Alignment with Paris Agreement 1.5°C pathway' },
  { slug: 'effectiveCarbonPrice', name: 'Effective Carbon Price', category: 'climate', unit: '$/ton', direction: 'higher_better', description: 'Weighted average carbon price across all pricing mechanisms' },
  { slug: 'tradeOpennessIndex', name: 'Trade Openness', category: 'trade', unit: '/100', direction: 'higher_better', description: 'Composite measure of tariff levels, NTBs, and FTA network' },
  { slug: 'tradeProtectionIndex', name: 'Trade Protection', category: 'trade', unit: '/100', direction: 'neutral', description: 'Measures tariff barriers, sanctions, and export controls' },
  { slug: 'sanctionExposure', name: 'Sanctions Exposure', category: 'trade', unit: '/100', direction: 'neutral', description: 'Extent of sanctions imposed by or on a country' },
  { slug: 'immigrationOpenness', name: 'Immigration Openness', category: 'immigration', unit: '/100', direction: 'higher_better', description: 'Visa-free access, work permits, asylum acceptance, citizenship pathways' },
  { slug: 'borderControlIntensity', name: 'Border Control Intensity', category: 'immigration', unit: '/100', direction: 'neutral', description: 'Physical barriers, surveillance, enforcement budget' },
  { slug: 'visaFreedomGranted', name: 'Visa Freedom Granted', category: 'immigration', unit: '/100', direction: 'higher_better', description: 'Number of visa-free or visa-on-arrival destinations granted' },
];

// Real-world approximate scores
export const countryMetrics: CountryMetrics[] = [
  { iso: 'US', climate: { carbonPolicyStrength: 52, climateActionAlignment: 38, effectiveCarbonPrice: 15 }, trade: { tradeOpennessIndex: 62, tradeProtectionIndex: 48, sanctionExposure: 72 }, immigration: { immigrationOpenness: 55, borderControlIntensity: 78, visaFreedomGranted: 65 } },
  { iso: 'CN', climate: { carbonPolicyStrength: 41, climateActionAlignment: 25, effectiveCarbonPrice: 10 }, trade: { tradeOpennessIndex: 45, tradeProtectionIndex: 62, sanctionExposure: 58 }, immigration: { immigrationOpenness: 22, borderControlIntensity: 85, visaFreedomGranted: 35 } },
  { iso: 'DE', climate: { carbonPolicyStrength: 82, climateActionAlignment: 72, effectiveCarbonPrice: 55 }, trade: { tradeOpennessIndex: 78, tradeProtectionIndex: 25, sanctionExposure: 42 }, immigration: { immigrationOpenness: 68, borderControlIntensity: 45, visaFreedomGranted: 82 } },
  { iso: 'GB', climate: { carbonPolicyStrength: 75, climateActionAlignment: 65, effectiveCarbonPrice: 48 }, trade: { tradeOpennessIndex: 72, tradeProtectionIndex: 30, sanctionExposure: 55 }, immigration: { immigrationOpenness: 52, borderControlIntensity: 62, visaFreedomGranted: 78 } },
  { iso: 'FR', climate: { carbonPolicyStrength: 78, climateActionAlignment: 68, effectiveCarbonPrice: 50 }, trade: { tradeOpennessIndex: 76, tradeProtectionIndex: 28, sanctionExposure: 40 }, immigration: { immigrationOpenness: 58, borderControlIntensity: 55, visaFreedomGranted: 80 } },
  { iso: 'JP', climate: { carbonPolicyStrength: 55, climateActionAlignment: 42, effectiveCarbonPrice: 3 }, trade: { tradeOpennessIndex: 68, tradeProtectionIndex: 35, sanctionExposure: 30 }, immigration: { immigrationOpenness: 35, borderControlIntensity: 65, visaFreedomGranted: 88 } },
  { iso: 'IN', climate: { carbonPolicyStrength: 45, climateActionAlignment: 48, effectiveCarbonPrice: 1 }, trade: { tradeOpennessIndex: 42, tradeProtectionIndex: 55, sanctionExposure: 15 }, immigration: { immigrationOpenness: 30, borderControlIntensity: 60, visaFreedomGranted: 40 } },
  { iso: 'BR', climate: { carbonPolicyStrength: 48, climateActionAlignment: 45, effectiveCarbonPrice: 0 }, trade: { tradeOpennessIndex: 38, tradeProtectionIndex: 58, sanctionExposure: 8 }, immigration: { immigrationOpenness: 62, borderControlIntensity: 32, visaFreedomGranted: 55 } },
  { iso: 'AU', climate: { carbonPolicyStrength: 58, climateActionAlignment: 48, effectiveCarbonPrice: 0 }, trade: { tradeOpennessIndex: 74, tradeProtectionIndex: 28, sanctionExposure: 35 }, immigration: { immigrationOpenness: 60, borderControlIntensity: 72, visaFreedomGranted: 75 } },
  { iso: 'CA', climate: { carbonPolicyStrength: 72, climateActionAlignment: 58, effectiveCarbonPrice: 50 }, trade: { tradeOpennessIndex: 76, tradeProtectionIndex: 22, sanctionExposure: 38 }, immigration: { immigrationOpenness: 78, borderControlIntensity: 40, visaFreedomGranted: 72 } },
  { iso: 'KR', climate: { carbonPolicyStrength: 52, climateActionAlignment: 38, effectiveCarbonPrice: 8 }, trade: { tradeOpennessIndex: 72, tradeProtectionIndex: 32, sanctionExposure: 22 }, immigration: { immigrationOpenness: 38, borderControlIntensity: 58, visaFreedomGranted: 82 } },
  { iso: 'SA', climate: { carbonPolicyStrength: 18, climateActionAlignment: 12, effectiveCarbonPrice: 0 }, trade: { tradeOpennessIndex: 55, tradeProtectionIndex: 42, sanctionExposure: 28 }, immigration: { immigrationOpenness: 28, borderControlIntensity: 82, visaFreedomGranted: 42 } },
  { iso: 'NG', climate: { carbonPolicyStrength: 22, climateActionAlignment: 20, effectiveCarbonPrice: 0 }, trade: { tradeOpennessIndex: 35, tradeProtectionIndex: 52, sanctionExposure: 12 }, immigration: { immigrationOpenness: 45, borderControlIntensity: 38, visaFreedomGranted: 30 } },
  { iso: 'SE', climate: { carbonPolicyStrength: 92, climateActionAlignment: 88, effectiveCarbonPrice: 120 }, trade: { tradeOpennessIndex: 82, tradeProtectionIndex: 18, sanctionExposure: 35 }, immigration: { immigrationOpenness: 72, borderControlIntensity: 35, visaFreedomGranted: 85 } },
  { iso: 'SG', climate: { carbonPolicyStrength: 48, climateActionAlignment: 35, effectiveCarbonPrice: 25 }, trade: { tradeOpennessIndex: 95, tradeProtectionIndex: 8, sanctionExposure: 18 }, immigration: { immigrationOpenness: 55, borderControlIntensity: 70, visaFreedomGranted: 90 } },
];

export function getMetrics(iso: string): CountryMetrics | undefined {
  return countryMetrics.find(m => m.iso === iso.toUpperCase());
}

export function getMetricScore(iso: string, category: CategoryKey): number {
  const m = getMetrics(iso);
  if (!m) return 0;
  if (category === 'climate') return Math.round((m.climate.carbonPolicyStrength + m.climate.climateActionAlignment) / 2);
  if (category === 'trade') return m.trade.tradeOpennessIndex;
  if (category === 'immigration') return m.immigration.immigrationOpenness;
  return 0;
}

export function getCategoryColor(category: CategoryKey): string {
  const colors = { climate: '#10B981', trade: '#3B82F6', immigration: '#8B5CF6' };
  return colors[category];
}

export function getCategoryLabel(category: CategoryKey): string {
  const labels = { climate: 'Climate & Environment', trade: 'Trade & Tariffs', immigration: 'Immigration & Borders' };
  return labels[category];
}
