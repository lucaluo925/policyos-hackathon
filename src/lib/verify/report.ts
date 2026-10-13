import type { AssertionResult, EvidenceDoc, OverallVerdict, ReviewPersistence, VerificationResult } from './types';
import { researchLeadForReport, type BoundResearchLead } from '../intelligence/research-lead';

/** Old recordings may lack excerpts. Preserve that absence rather than inventing one. */
export interface ReportDoc extends Omit<EvidenceDoc, 'snippet'> {
  snippet?: string;
  relevant?: boolean;
  leaning?: string;
  reason?: string;
}

export interface RecordedVerification {
  id: string;
  claim: string;
  ranAt: string;
  decomposeModel: string;
  overall: OverallVerdict;
  assertions: AssertionResult[];
  docs: Record<string, ReportDoc[]>;
  stats: Pick<VerificationResult['stats'], 'tavilyCalls' | 'modelCalls' | 'elapsedMs'>;
  tavilyRequestIds?: string[];
  provenance?: VerificationResult['provenance'];
  /** Public recording contains exact model inputs, while earlier retrieval text is withheld. */
  publicEvidenceScope?: 'adjudication_only';
  sourceAttribution?: {
    label: string;
    url: string;
    reuseNoticeUrl: string;
    primaryDocumentUrl: string;
    publicationDate: string;
    correctionDate?: string;
    selectionNotice: string;
  };
}

export interface VerificationReport {
  schemaVersion: 1;
  kind: 'live' | 'recorded';
  claim: string;
  ranAt: string | null;
  exportedAt: string;
  overall: OverallVerdict;
  assertions: AssertionResult[];
  evidence: Record<string, ReportDoc[]>;
  /** Null means no exact prompt evidence was saved in this older recording. */
  adjudicationEvidence: Record<string, EvidenceDoc[]> | null;
  models: { decomposer: string | null; screener: string | null; adjudicator: string | null };
  decompositionFallback?: 'whole_claim';
  stats: RecordedVerification['stats'];
  tavilyRequestIds: string[] | null;
  sourceInspection?: NonNullable<VerificationResult['provenance']>['sourceInspection'];
  issuerHtmlReads?: NonNullable<VerificationResult['provenance']>['issuerHtmlReads'];
  modelCalls: NonNullable<NonNullable<VerificationResult['provenance']>['modelCalls']> | null;
  reviewPersistence?: ReviewPersistence;
  leadContext?: { kind: 'unverified_lead'; headline: string; sourceUrl: string; selectedAt: string };
  publicEvidenceScope?: RecordedVerification['publicEvidenceScope'];
  sourceAttribution?: RecordedVerification['sourceAttribution'];
  notes: string[];
}

const NOTES = [
  'Verdicts and confidence are model output, not independently calibrated truth labels.',
  'Excerpts are truncated search results or selected source passages, not the full source documents.',
  'Retrieval scores measure search relevance, not truth or source authority.',
  'A recognized official domain does not establish that its publisher issued the measure or that a cited excerpt proves the claim.',
  'AI-inferred verification cannot automatically change a country score.',
];

export function liveReport(
  result: VerificationResult,
  evidence: Record<string, ReportDoc[]>,
  exportedAt = new Date().toISOString(),
  boundLead?: BoundResearchLead | null,
  reviewPersistence?: ReviewPersistence | null,
): VerificationReport {
  const lead = researchLeadForReport(boundLead, result.claim);
  return {
    schemaVersion: 1, kind: 'live', claim: result.claim,
    ranAt: result.provenance?.completedAt ?? null, exportedAt,
    overall: result.overall, assertions: result.assertions, evidence,
    adjudicationEvidence: result.provenance?.adjudicationEvidence ?? null,
    models: result.provenance?.models ?? { decomposer: null, screener: null, adjudicator: null },
    ...(result.provenance?.decompositionFallback ? { decompositionFallback: result.provenance.decompositionFallback } : {}),
    stats: result.stats, tavilyRequestIds: result.tavilyRequestIds,
    modelCalls: result.provenance?.modelCalls ?? null,
    ...(reviewPersistence ? { reviewPersistence } : {}),
    ...(result.provenance?.sourceInspection ? { sourceInspection: result.provenance.sourceInspection } : {}),
    ...(result.provenance?.issuerHtmlReads ? { issuerHtmlReads: result.provenance.issuerHtmlReads } : {}),
    ...(lead ? { leadContext: { kind: 'unverified_lead' as const, headline: lead.claim, sourceUrl: lead.sourceUrl, selectedAt: lead.selectedAt } } : {}),
    notes: [...NOTES,
      ...(result.provenance?.decompositionFallback === 'whole_claim'
        ? ['Model decomposition failed twice; the original claim was checked as one assertion, without atomic splitting.'] : []),
      ...(lead ? ['Lead context is client-supplied research metadata, not retrieved evidence, a verified citation or model input.'] : []),
      ...(!result.provenance ? ['Exact prompt evidence and server run time were not recorded by this version.'] : [])],
  };
}

export function recordedReport(
  recording: RecordedVerification,
  exportedAt = new Date().toISOString(),
): VerificationReport {
  return {
    schemaVersion: 1, kind: 'recorded', claim: recording.claim,
    ranAt: recording.ranAt, exportedAt,
    overall: recording.overall, assertions: recording.assertions, evidence: recording.docs,
    adjudicationEvidence: recording.provenance?.adjudicationEvidence ?? null,
    models: recording.provenance?.models ?? { decomposer: recording.decomposeModel, screener: null, adjudicator: null },
    ...(recording.provenance?.decompositionFallback ? { decompositionFallback: recording.provenance.decompositionFallback } : {}),
    stats: recording.stats, tavilyRequestIds: recording.tavilyRequestIds ?? null,
    modelCalls: recording.provenance?.modelCalls ?? null,
    ...(recording.provenance?.sourceInspection ? { sourceInspection: recording.provenance.sourceInspection } : {}),
    ...(recording.provenance?.issuerHtmlReads ? { issuerHtmlReads: recording.provenance.issuerHtmlReads } : {}),
    ...(recording.publicEvidenceScope ? { publicEvidenceScope: recording.publicEvidenceScope } : {}),
    ...(recording.sourceAttribution ? { sourceAttribution: recording.sourceAttribution } : {}),
    notes: [...NOTES, 'This is a historical run, not a live check or proof of the current policy state.',
      ...(recording.provenance?.decompositionFallback === 'whole_claim'
        ? ['Model decomposition failed twice; the original claim was checked as one assertion, without atomic splitting.'] : []),
      ...(recording.publicEvidenceScope === 'adjudication_only' ? ['This public recording contains the exact passages submitted to adjudication; earlier retrieval and screening passages are withheld.'] : []),
      ...(!recording.provenance ? ['Exact prompt evidence and some model names were not saved in this older recording.'] : [])],
  };
}

/** Keep source text literal when opened in a Markdown viewer. */
function text(value: string): string {
  return value.replace(/([\\`*_{}\[\]()#+.!|<>-])/g, '\\$1');
}

function quote(value: string): string {
  return value.split(/\r?\n/).map((line) => `> ${text(line)}`).join('\n');
}

function sourceLink(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') {
      const target = url.href.replace(/</g, '%3C').replace(/>/g, '%3E');
      return `[${text(value)}](<${target}>)`;
    }
  } catch { /* Preserve malformed links as literal text. */ }
  return text(value);
}

export function reportMarkdown(report: VerificationReport): string {
  const lines = [
    '# PolicyOS Verification Report', '',
    `Run: ${report.kind === 'recorded' ? 'HISTORICAL RECORDING' : 'Live verification'}`,
    `Run time: ${report.ranAt ?? 'Not recorded'}`,
    `Exported: ${report.exportedAt}`, '', '## Claim', '', quote(report.claim), '',
    `Overall: ${report.overall}`, '', '## Tool usage', '',
    `Retrieval: Tavily Search API${report.sourceInspection ? '; optional Tavily Extract source inspection requested' : ''}${report.issuerHtmlReads ? '; bounded direct source URL reads attempted' : ''}`,
    `Decomposition model: ${report.models.decomposer ?? 'Not recorded'}`,
    ...(report.decompositionFallback === 'whole_claim'
      ? ['Decomposition fallback: original claim checked as one assertion after two model transport failures'] : []),
    `Screening model: ${report.models.screener ?? 'Not recorded'}`,
    `Adjudication model: ${report.models.adjudicator ?? 'Not recorded'}`,
    `Inference provider: Nebius Token Factory`,
    `Tavily calls: ${report.stats.tavilyCalls}; model calls: ${report.stats.modelCalls}; elapsed: ${report.stats.elapsedMs} ms`,
    `Tavily request IDs: ${report.tavilyRequestIds === null ? 'Not recorded' : report.tavilyRequestIds.filter(Boolean).join(', ') || 'None recorded'}`, '',
  ];
  if (report.kind === 'live') lines.push(
    `Review queue: ${report.reviewPersistence?.status === 'saved'
      ? `saved ${report.reviewPersistence.savedAssertions} assertion(s) for human review`
      : report.reviewPersistence?.status === 'skipped'
        ? 'not saved (review storage unavailable in this run)'
        : report.reviewPersistence?.status === 'failed'
          ? 'save failed or incomplete; inspect the report directly'
          : 'status not recorded; do not assume saved'}`,
    '',
  );
  if (report.leadContext) lines.push('## Original lead (unverified context)', '',
    quote(report.leadContext.headline), '', sourceLink(report.leadContext.sourceUrl), '',
    `Selected: ${text(report.leadContext.selectedAt)} (selection time, not publication time)`, '',
    'This article was the research lead. It was not supplied to the model or added to retrieved evidence or verified citations.', '');
  if (report.sourceAttribution) lines.push('## Source attribution', '',
    text(report.sourceAttribution.label), '',
    sourceLink(report.sourceAttribution.url), '',
    `Primary document: ${sourceLink(report.sourceAttribution.primaryDocumentUrl)}`,
    `Publication date: ${text(report.sourceAttribution.publicationDate)}`,
    ...(report.sourceAttribution.correctionDate ? [`Correction published: ${text(report.sourceAttribution.correctionDate)}`] : []),
    `Reuse notice: ${sourceLink(report.sourceAttribution.reuseNoticeUrl)}`,
    text(report.sourceAttribution.selectionNotice), '',
    ...(report.publicEvidenceScope === 'adjudication_only' ? ['Public evidence scope: exact adjudication passages only; earlier retrieval and screening passages are withheld.', ''] : []));
  if (report.modelCalls === null) lines.push('Model response diagnostics: not recorded by this version.', '');
  else {
    lines.push('### Model response diagnostics', '',
      '| Stage | Assertion | Model | Outcome | HTTP | Finish reason | Failure kind | Prompt tokens | Completion tokens | Reasoning tokens |',
      '|---|---|---|---|---|---|---|---|---|---|');
    for (const call of report.modelCalls) lines.push(
      `| ${call.stage} | ${call.assertionId ?? 'All'} | ${text(call.model)} | ${call.outcome} | ${call.httpStatus ?? 'Unknown'} | ${call.finishReason ?? 'Unknown'} | ${call.failureKind ?? 'None'} | ${call.usage.promptTokens ?? 'Unknown'} | ${call.usage.completionTokens ?? 'Unknown'} | ${call.usage.reasoningTokens ?? 'Unknown'} |`,
    );
    lines.push('', 'A returned tool call is not a truth or schema-validity guarantee. Reasoning tokens are included in completion tokens.', '');
  }
  for (const assertion of report.assertions) {
    lines.push(`## Assertion ${text(assertion.assertion.id)}`, '', quote(assertion.assertion.text), '',
      `Verdict: ${assertion.verdict}; model self-reported confidence: ${assertion.confidence}`,
      `Conflicting screened evidence: ${assertion.conflicted ? 'yes' : 'no'}`, '', text(assertion.rationale), '',
      '### Cited sources', '');
    if (!assertion.citedUrls.length) lines.push('None.', '');
    for (const url of assertion.citedUrls) lines.push(sourceLink(url), '');
    const inspection = report.sourceInspection?.[assertion.assertion.id];
    if (inspection) lines.push('### Source page inspection', '',
      `Status: ${inspection.status}; pages read: ${inspection.extractedUrls.length}/${inspection.requestedUrls.length}`,
      `Extract request ID: ${text(inspection.requestId || 'Not recorded')}`,
      `Credits reported by API: ${inspection.creditsReported ?? 'Not recorded'} (billing may occur in batches; zero does not mean free)`,
      `Pages retaining Search excerpts: ${inspection.failedUrls.map(text).join(', ') || 'None'}`, '');
    if (inspection?.preservedSearchUrls?.length) lines.push(
      `More-specific Search excerpts retained after page read: ${inspection.preservedSearchUrls.map(text).join(', ')}`, '');
    const htmlReads = report.issuerHtmlReads?.[assertion.assertion.id];
    if (htmlReads?.length) lines.push('### Direct source URL HTML reads', '',
      ...htmlReads.map(read => `${sourceLink(read.url)} — ${read.status}${read.bytes === undefined ? '' : `; ${read.bytes} bytes`}`), '');
    lines.push(report.publicEvidenceScope === 'adjudication_only'
      ? '### Public adjudication passages' : '### Retrieved evidence', '');
    for (const doc of report.evidence[assertion.assertion.id] ?? []) {
      lines.push(`**${text(doc.title)}**`, '', sourceLink(doc.url), '',
        ...(doc.searchRequestId === undefined ? [] : [`Search request ID: ${text(doc.searchRequestId || 'Not recorded')}`, '']),
        ...(doc.extractionRequestId === undefined ? [] : [`Excerpt origin: Tavily Extract; request ID: ${text(doc.extractionRequestId || 'Not recorded')}`, '']),
        ...(doc.issuerHtmlRead ? ['Excerpt origin: bounded direct HTML read of the Tavily-discovered source URL', ''] : []),
        `Search relevance: ${doc.retrievalScore}; screening: ${doc.relevant === undefined ? 'not recorded' : doc.relevant ? 'kept' : 'discarded'}; cited: ${assertion.citedUrls.includes(doc.url) ? 'yes' : 'no'}`, '',
        doc.snippet ? quote(doc.snippet) : 'Excerpt not saved in this recording.', '');
    }
    lines.push('### Exact excerpts submitted to adjudication', '');
    if (report.adjudicationEvidence === null) lines.push('Not saved in this older recording.', '');
    else {
      const docs = report.adjudicationEvidence[assertion.assertion.id] ?? [];
      if (!docs.length) lines.push('No documents were submitted to adjudication for this assertion.', '');
      for (const doc of docs) lines.push(sourceLink(doc.url), '',
        ...(doc.issuerHtmlRead ? ['Excerpt origin: bounded direct source URL HTML read', ''] : []),
        quote(doc.snippet), '');
    }
  }
  lines.push('## Limits', '', ...report.notes.map((note) => `- ${note}`), '');
  return lines.join('\n');
}

export function reportFilename(report: VerificationReport, extension: 'md' | 'json'): string {
  const date = (report.ranAt ?? report.exportedAt).replace(/[^0-9TZ]/g, '').slice(0, 16);
  return `policyos-verification-${report.kind}-${date}.${extension}`;
}
