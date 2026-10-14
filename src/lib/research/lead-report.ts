import type { CountryResearchResult, CountryResearchScope } from './country';

export function countryResearchReport(result: CountryResearchResult,
  latestAttempt: { status: 'pending' | 'failed' | 'complete'; scope: CountryResearchScope },
  now = new Date()) {
  return { schemaVersion: 1, kind: 'country-research-leads', exportedAt: now.toISOString(),
    latestAttempt: { ...latestAttempt }, retained: latestAttempt.status !== 'complete',
    result: structuredClone(result),
    notes: ['Search hits are unverified research leads, not policy verdicts or scores.',
      'The original search date, scope, source links and Tavily request ID are preserved.',
      'Export does not run another search or model. Retained results do not mean the latest attempt succeeded.'] };
}
