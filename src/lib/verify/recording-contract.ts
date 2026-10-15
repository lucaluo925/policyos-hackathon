import type { RecordedVerification } from './report';

type Guard = (value: unknown) => boolean;
const string: Guard = value => typeof value === 'string';
const boolean: Guard = value => typeof value === 'boolean';
const number: Guard = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count: Guard = value => number(value) && Number.isSafeInteger(value);
const optional = (guard: Guard): Guard => value => value === undefined || guard(value);
const oneOf = (...values: string[]): Guard => value => typeof value === 'string' && values.includes(value);
const array = (guard: Guard): Guard => value => Array.isArray(value) && value.every(guard);
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const object = (fields: Record<string, Guard>): Guard => value => record(value) && Object.entries(fields).every(([key, guard]) => guard(value[key]));
const dictionary = (guard: Guard): Guard => value => record(value) && Object.values(value).every(guard);
const date: Guard = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const url: Guard = value => {
  if (typeof value !== 'string') return false;
  try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password; }
  catch { return false; }
};
const urls = array(url), strings = array(string);
const verdict = oneOf('supported', 'refuted', 'insufficient_evidence');
const docFields = {
  url, title: string, retrievalScore: number, snippet: optional(string),
  searchRequestId: optional(string), extractionRequestId: optional(string),
  relevant: optional(boolean), leaning: optional(string), reason: optional(string),
  issuerHtmlRead: optional(boolean),
  issuerDiscovery: optional(object({ seedUrl: url, indexUrl: url, seedRequestId: optional(string), readBytes: count })),
};
const doc = object(docFields);
const exactDoc = object({ ...docFields, snippet: string });
const assertion = object({
  assertion: object({ id: string, text: string }), verdict,
  confidence: value => number(value) && (value as number) <= 1,
  citedUrls: urls, rationale: string, conflicted: boolean,
});
const provenance = object({
  startedAt: optional(date), completedAt: optional(date),
  models: optional(object({ decomposer: string, screener: string, adjudicator: string })),
  decompositionFallback: optional(oneOf('whole_claim')),
  adjudicationEvidence: optional(dictionary(array(exactDoc))),
  sourceInspection: optional(dictionary(object({
    status: oneOf('done', 'partial', 'failed', 'skipped_budget'),
    requestedUrls: urls, extractedUrls: urls, failedUrls: urls,
    preservedSearchUrls: optional(urls), requestId: optional(string), creditsReported: optional(number),
  }))),
  issuerHtmlReads: optional(dictionary(array(object({ url, status: oneOf('used', 'unavailable'), bytes: optional(count) })))),
  searches: optional(array(object({
    assertionId: string, kind: oneOf('open', 'recovery', 'official'), requestId: string,
    query: string, depth: oneOf('basic', 'advanced'), includeDomains: strings,
    returnedUrls: urls, excludedNavigationUrls: urls, elapsedMs: number,
  }))),
  modelCalls: optional(array(object({
    stage: oneOf('decompose', 'screen', 'adjudicate'), assertionId: optional(string),
    model: string, tool: string, outcome: oneOf('tool_returned', 'failed'),
    failureKind: optional(string), finishReason: optional(string), httpStatus: optional(count), elapsedMs: number,
    usage: object({ promptTokens: optional(count), completionTokens: optional(count), reasoningTokens: optional(count) }),
  }))),
});
const recording = object({
  id: string, claim: string, ranAt: date, decomposeModel: string, overall: verdict,
  assertions: array(assertion), docs: dictionary(array(doc)),
  stats: object({ tavilyCalls: count, modelCalls: count, elapsedMs: number }),
  tavilyRequestIds: optional(strings), provenance: optional(provenance),
  publicEvidenceScope: oneOf('adjudication_only', 'selected_adjudication'),
  omittedAdjudicationUrls: optional(dictionary(urls)),
  sourceAttribution: object({
    label: string, url, primaryDocumentUrl: url, reuseNoticeUrl: url,
    publicationDate: optional(date), correctionDate: optional(date), selectionNotice: string,
  }),
});

/** Validate every field consumed by the page and report before React state is
 * replaced. Preserve the actual historical object, including optional absences;
 * structural validation is not a new verdict or evidence-accuracy check. */
export function validatedPublicRecording(value: unknown): RecordedVerification {
  if (!recording(value)) throw new Error('Unexpected recording scope or data');
  const result = value as RecordedVerification;
  const ids = result.assertions.map(row => row.assertion.id);
  if (!ids.length || ids.some(id => !id.trim()) || new Set(ids).size !== ids.length) throw new Error('Unexpected recording assertions');
  return result;
}
