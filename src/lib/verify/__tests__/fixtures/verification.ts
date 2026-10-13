import type { VerificationResult } from '../../types';

/** Synthetic text only. No provider calls or third-party excerpts. */
export const archivedResult: VerificationResult = {
  claim: 'OFFLINE fixture: two independently checkable dates.',
  assertions: [1, 2].map(n => ({
    assertion: { id: `a${n}`, text: `Synthetic rule ${n} starts in 2026.` },
    verdict: 'supported' as const, confidence: 0.8, conflicted: false,
    citedUrls: [`https://example.invalid/rule-${n}`], rationale: `Synthetic reason ${n}.`,
  })),
  overall: 'supported', tavilyRequestIds: ['search-1', 'extract-1', 'search-2'],
  stats: { retrieved: 2, screenedRelevant: 2, adjudicated: 2, tavilyCalls: 3, modelCalls: 5, elapsedMs: 1000 },
  provenance: {
    startedAt: '2026-10-13T00:00:00Z', completedAt: '2026-10-13T00:00:01Z',
    models: { decomposer: 'fixture-super', screener: 'fixture-super', adjudicator: 'fixture-ultra' },
    adjudicationEvidence: {
      a1: [{ url: 'https://example.invalid/rule-1', title: 'Synthetic source', retrievalScore: 0.9,
        snippet: 'Scope: 企业 A & B.\nDate: 1 July 2026.\n<script>literal source text</script>',
        searchRequestId: 'search-1', extractionRequestId: 'extract-1' }],
      a2: [{ url: 'https://example.invalid/rule-2', title: 'Synthetic source 2', retrievalScore: 0.8,
        snippet: 'Scope: crew only.\nDate: 2 July 2026.', searchRequestId: 'search-2' }],
    },
    sourceInspection: { a1: { status: 'done', requestedUrls: ['https://example.invalid/rule-1'],
      extractedUrls: ['https://example.invalid/rule-1'], failedUrls: [], requestId: 'extract-1' } },
    issuerHtmlReads: { a2: [{ url: 'https://example.invalid/rule-2', status: 'unavailable' }] },
    modelCalls: [{ model: 'fixture-super', tool: 'record_assertions', outcome: 'tool_returned',
      elapsedMs: 50, usage: { promptTokens: 100, completionTokens: 50 }, httpStatus: 200,
      finishReason: 'tool_calls', stage: 'decompose' }],
  },
};
