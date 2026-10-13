import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { liveReport, recordedReport, reportFilename, reportMarkdown, type RecordedVerification } from '../report';
import type { VerificationResult } from '../types';
import { bindResearchLead, makeResearchLead } from '../../intelligence/research-lead';

function result(): VerificationResult {
  return {
    claim: 'The policy takes effect in 2020.',
    assertions: [{ assertion: { id: 'a1', text: 'The policy takes effect in 2020.' },
      verdict: 'supported', confidence: 0.8, citedUrls: ['https://example.gov/policy'],
      rationale: 'The notice states the date.', conflicted: false }],
    overall: 'supported', tavilyRequestIds: ['search-123'],
    stats: { retrieved: 2, screenedRelevant: 1, adjudicated: 1, tavilyCalls: 1, modelCalls: 3, elapsedMs: 8000 },
    provenance: { startedAt: '2026-10-11T18:00:00.000Z', completedAt: '2026-10-11T18:00:08.000Z',
      models: { decomposer: 'measured-small', screener: 'measured-small', adjudicator: 'measured-large' },
      adjudicationEvidence: { a1: [{ url: 'https://example.gov/policy', title: 'Notice', retrievalScore: 0.9,
        snippet: 'Effective in 2020.' }] } },
  };
}

test('a lead is exported separately without becoming evidence, a citation or prompt input', () => {
  const saved = result();
  const now = Date.parse('2026-10-11T18:00:00Z');
  const lead = makeResearchLead({ claim: 'An original headline', sourceUrl: 'https://lead.example/article' }, now)!;
  const bound = bindResearchLead(lead, saved.claim, now)!;
  const report = liveReport(saved, {}, '2026-10-12T00:00:00Z', bound);
  assert.equal(report.leadContext?.kind, 'unverified_lead');
  assert.equal(report.leadContext?.sourceUrl, lead.sourceUrl);
  assert.deepEqual(report.assertions, saved.assertions);
  assert.deepEqual(report.adjudicationEvidence, saved.provenance?.adjudicationEvidence);
  assert.deepEqual(report.evidence, {});
  const markdown = reportMarkdown(report);
  assert.match(markdown, /Original lead \(unverified context\)/);
  assert.match(markdown, /not supplied to the model/);
  assert.ok(!liveReport({ ...saved, claim: 'A different completed claim' }, {}, undefined, bound).leadContext);
});

test('historical recordings never acquire the current browser lead', () => {
  const saved = result();
  const recording: RecordedVerification = { id: 'old', claim: saved.claim, ranAt: '2026-10-08T18:00:00Z', decomposeModel: 'old-model', overall: saved.overall, assertions: saved.assertions, docs: {}, stats: saved.stats };
  assert.equal(recordedReport(recording).leadContext, undefined);
});

test('a live export carries the completed claim, server time and exact evidence separately from retrieval', () => {
  const saved = result();
  const report = liveReport(saved, { a1: [{ url: 'https://example.gov/policy', title: 'Notice',
    retrievalScore: 0.9, snippet: 'Effective in 2020. Longer surrounding context.' }] }, '2026-10-12T00:00:00Z');
  const roundtrip = JSON.parse(JSON.stringify(report));
  assert.equal(roundtrip.claim, saved.claim);
  assert.equal(roundtrip.ranAt, saved.provenance?.completedAt);
  assert.equal(roundtrip.exportedAt, '2026-10-12T00:00:00Z');
  assert.equal(roundtrip.adjudicationEvidence.a1[0].snippet, 'Effective in 2020.');
  assert.equal(roundtrip.evidence.a1[0].snippet, 'Effective in 2020. Longer surrounding context.');
  assert.deepEqual(roundtrip.tavilyRequestIds, ['search-123']);
});

test('a live export distinguishes confirmed review storage from a failed or unknown write', () => {
  const saved = liveReport(result(), {}, undefined, null, { status: 'saved', savedAssertions: 1 });
  assert.match(reportMarkdown(saved), /Review queue: saved 1 assertion\(s\)/);
  const failed = liveReport(result(), {}, undefined, null, { status: 'failed', savedAssertions: 0 });
  assert.match(reportMarkdown(failed), /Review queue: save failed or incomplete/);
  assert.match(reportMarkdown(liveReport(result(), {})), /status not recorded; do not assume saved/);
});

test('legacy live results do not invent timestamps, models or prompt evidence', () => {
  const legacy = result();
  delete legacy.provenance;
  const report = liveReport(legacy, {});
  assert.equal(report.ranAt, null);
  assert.equal(report.adjudicationEvidence, null);
  assert.deepEqual(report.models, { decomposer: null, screener: null, adjudicator: null });
});

test('legacy recordings remain historical and missing request IDs stay unknown', () => {
  const live = result();
  const recording: RecordedVerification = { id: 'old', claim: live.claim, ranAt: '2026-10-08T18:00:00Z',
    decomposeModel: 'old-model', overall: live.overall, assertions: live.assertions, docs: {}, stats: live.stats };
  const report = recordedReport(recording);
  assert.equal(report.kind, 'recorded');
  assert.equal(report.ranAt, recording.ranAt);
  assert.equal(report.models.decomposer, 'old-model');
  assert.equal(report.models.screener, null);
  assert.equal(report.adjudicationEvidence, null);
  assert.equal(report.tavilyRequestIds, null);
  assert.match(reportMarkdown(report), /HISTORICAL RECORDING/);
  assert.match(reportMarkdown(report), /not a live check/);
});

test('Markdown treats hostile claim and evidence text as quotations, and never links script URLs', () => {
  const live = result();
  live.claim = '<script>alert(1)</script>\n# Fake verdict';
  live.assertions[0].citedUrls = ['javascript:alert(1)', 'https://example.gov/policy'];
  const markdown = reportMarkdown(liveReport(live, { a1: [{ url: 'https://example.gov/policy',
    title: '[Fabricated](javascript:alert(1))', retrievalScore: 0.9,
    snippet: '<img src=x onerror=alert(1)>\n## Misleading heading' }] }));
  assert.ok(!markdown.includes('<script>'));
  assert.doesNotMatch(markdown, /(?<!\\)<img\b/);
  assert.ok(!markdown.includes('](<javascript:'));
  assert.ok(markdown.includes('](<https://example.gov/policy>)'));
  assert.ok(markdown.includes('> \\# Fake verdict'));
});

test('public claim starters include no historical verdict or retrieved passage', () => {
  const entries = JSON.parse(readFileSync('public/verify-prompts/index.json', 'utf8')) as Array<Record<string, unknown>>;
  assert.equal(entries.length, 13);
  for (const entry of entries) {
    assert.deepEqual(Object.keys(entry).sort(), ['claim', 'id']);
    assert.match(String(entry.id), /^[a-z0-9][a-z0-9-]{0,95}$/);
    assert.ok(String(entry.claim).length > 10);
  }
});

test('public BOE recording preserves exact adjudication inputs and cites only supplied official pages', () => {
  const path = 'public/verify-recordings/boe-service-passport-adjudication-20261012.json';
  const recording = JSON.parse(readFileSync(path, 'utf8')) as RecordedVerification;
  assert.equal(recording.publicEvidenceScope, 'adjudication_only');
  assert.equal(recording.sourceAttribution?.label, 'Basado en datos de la Agencia Estatal Boletín Oficial del Estado');
  assert.equal(recording.assertions.length, 2);
  for (const assertion of recording.assertions) {
    const id = assertion.assertion.id;
    const exact = recording.provenance?.adjudicationEvidence?.[id] ?? [];
    assert.ok(exact.length > 0);
    assert.deepEqual(recording.docs[id], exact);
    const exactUrls = new Set(exact.map((doc) => doc.url));
    for (const doc of exact) {
      assert.equal(new URL(doc.url).hostname, 'www.boe.es');
      assert.ok(doc.snippet.length > 0);
    }
    for (const citation of assertion.citedUrls) assert.ok(exactUrls.has(citation));
  }
  const report = recordedReport(recording, '2026-10-12T20:00:00Z');
  assert.equal(report.kind, 'recorded');
  assert.deepEqual(report.adjudicationEvidence, recording.provenance?.adjudicationEvidence);
  const markdown = reportMarkdown(report);
  assert.match(markdown, /HISTORICAL RECORDING/);
  assert.match(markdown, /Public evidence scope: exact adjudication passages only/);
  assert.match(markdown, /Basado en datos de la Agencia Estatal Boletín Oficial del Estado/);
  assert.match(markdown, /Public adjudication passages/);
});

test('report file names distinguish live from recorded results and contain only safe characters', () => {
  const report = liveReport(result(), {});
  assert.match(reportFilename(report, 'md'), /^policyos-verification-live-[0-9TZ]+\.md$/);
  assert.match(reportFilename({ ...report, kind: 'recorded' }, 'json'), /^policyos-verification-recorded-[0-9TZ]+\.json$/);
});

test('filmed EU recording exports its incomplete evidence scope without relabeling it live or complete', () => {
  const recording = JSON.parse(readFileSync('public/verify-recordings/eu-ai-act-entry-20261013.json', 'utf8')) as RecordedVerification;
  const report = recordedReport(recording, '2026-10-13T06:00:00Z');
  assert.equal(report.kind, 'recorded');
  assert.equal(report.ranAt, '2026-10-13T04:33:55.739Z');
  assert.equal(report.overall, 'refuted');
  assert.equal(report.publicEvidenceScope, 'selected_adjudication');
  assert.equal(report.adjudicationEvidence?.a1.length, 1);
  assert.equal(report.omittedAdjudicationUrls?.a1.length, 6);
  assert.deepEqual(report.evidence.a1, report.adjudicationEvidence?.a1);
  assert.equal(report.adjudicationEvidence?.a1[0].snippet.length, 900);
  assert.match(report.adjudicationEvidence?.a1[0].snippet ?? '', /entered into force on 1 August 2024/);
  assert.deepEqual(report.assertions[0].citedUrls, report.evidence.a1.map(d => d.url));
  assert.equal(report.stats.tavilyCalls, 3);
  assert.equal(report.stats.modelCalls, 3);
  for (const url of report.omittedAdjudicationUrls?.a1 ?? []) {
    assert.ok(!report.evidence.a1.some(d => d.url === url));
  }
  const markdown = reportMarkdown(report);
  assert.match(markdown, /HISTORICAL RECORDING/);
  assert.match(markdown, /Published: 1 unchanged adjudication passage\(s\). Withheld: 6/);
  assert.match(markdown, /Selected exact excerpts submitted to adjudication \(incomplete input\)/);
  assert.match(markdown, /European Union/);
  assert.doesNotMatch(markdown, /Publication date: undefined|Correction published: undefined|BOE/);
  assert.ok(report.notes.some(note => note.includes('not the complete model input')));
});
