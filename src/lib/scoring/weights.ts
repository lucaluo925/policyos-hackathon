/**
 * Score weight definitions.
 *
 * These are the defaults from the product spec. The `methodologyVersion`
 * string embeds in DomainScore rows so we can later evolve the weights
 * without silently invalidating historical score_change_logs.
 */

export const METHODOLOGY_VERSION = '1.0';

export interface SubmetricDef {
  key: string;
  label: string;
  weight: number; // sums to 100 within a domain
  /** If true, higher raw values *reduce* the domain score. */
  penalty?: boolean;
}

export const IMMIGRATION_SUBMETRICS: SubmetricDef[] = [
  { key: 'skilled_migration_accessibility', label: 'Skilled migration accessibility', weight: 25 },
  { key: 'permanent_residency_path_clarity', label: 'Permanent residency path clarity', weight: 20 },
  { key: 'student_to_work_transition', label: 'Student-to-work transition', weight: 15 },
  { key: 'family_reunification_openness', label: 'Family reunification openness', weight: 10 },
  { key: 'asylum_humanitarian_openness', label: 'Asylum / humanitarian openness', weight: 10 },
  { key: 'processing_transparency_predictability', label: 'Processing transparency', weight: 10 },
  { key: 'employer_dependency_restriction_penalty', label: 'Employer dependency (penalty)', weight: 10, penalty: true },
];

export const CLIMATE_SUBMETRICS: SubmetricDef[] = [
  { key: 'emissions_target_ambition', label: 'Emissions target ambition', weight: 20 },
  { key: 'carbon_pricing_or_equivalent', label: 'Carbon pricing or equivalent', weight: 15 },
  { key: 'renewable_support_strength', label: 'Renewable support strength', weight: 20 },
  { key: 'fossil_fuel_constraint_strength', label: 'Fossil fuel constraint strength', weight: 15 },
  { key: 'implementation_mechanism_strength', label: 'Implementation mechanism strength', weight: 15 },
  { key: 'adaptation_resilience_planning', label: 'Adaptation & resilience planning', weight: 10 },
  { key: 'international_commitment_alignment', label: 'International commitment alignment', weight: 5 },
];

export const TRADE_SUBMETRICS: SubmetricDef[] = [
  { key: 'tariff_openness', label: 'Tariff openness', weight: 20 },
  { key: 'fta_network_strength', label: 'FTA network strength', weight: 20 },
  { key: 'foreign_investment_openness', label: 'Foreign investment openness', weight: 15 },
  { key: 'export_control_restrictiveness_penalty', label: 'Export control restrictiveness (penalty)', weight: 15, penalty: true },
  { key: 'domestic_protectionism_penalty', label: 'Domestic protectionism (penalty)', weight: 15, penalty: true },
  { key: 'customs_efficiency_predictability', label: 'Customs efficiency & predictability', weight: 10 },
  { key: 'strategic_trade_intervention_balance', label: 'Strategic trade intervention balance', weight: 5 },
];

export const SUBMETRICS_BY_DOMAIN = {
  immigration: IMMIGRATION_SUBMETRICS,
  climate: CLIMATE_SUBMETRICS,
  trade: TRADE_SUBMETRICS,
} as const;

export type DomainKey = keyof typeof SUBMETRICS_BY_DOMAIN;
