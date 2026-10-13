import { test } from 'node:test';
import assert from 'node:assert/strict';

import { tagDocument, semisHitsFromBody, needsBodyScan, BIS_SLUG, USTR_SLUG } from '../tagger';
import { earliestInstant, publicationInstant, zonedWallTimeToUtc } from '../event-time';
import { buildDocumentsUrl, piLookbackDates, fetchAllDocuments, fetchPublicInspectionDay } from '../federal-register';
import { csvCell, toCsv } from '../csv';
import { toEventRecord } from '../build';
import type { FrDocument } from '../types';

const bis = [{ slug: BIS_SLUG, name: 'Industry and Security Bureau' }];
const ustr = [{ slug: USTR_SLUG, name: 'Trade Representative, Office of United States' }];

const doc = (over: Partial<FrDocument>): FrDocument => ({
  document_number: '2099-00001',
  title: '',
  type: 'Rule',
  action: 'Final rule.',
  abstract: '',
  publication_date: '2022-10-13',
  html_url: 'https://www.federalregister.gov/d/2099-00001',
  agencies: bis,
  ...over,
});

// ── tagger ────────────────────────────────────────────────────────────────
test('Oct-2022 advanced computing rule → advanced_computing_semis, tightening, relevant', () => {
  const t = tagDocument(
    doc({
      title:
        'Implementation of Additional Export Controls: Certain Advanced Computing and Semiconductor Manufacturing Items; Supercomputer and Semiconductor End Use; Entity List Modification',
      action: 'Interim final rule; request for comments.',
      abstract: "…restrict the People's Republic of China's (PRC) ability to obtain advanced computing chips…",
    }),
  );
  assert.equal(t.eventType, 'advanced_computing_semis');
  assert.equal(t.direction, 'tightening');
  assert.equal(t.chinaRelated, true);
  assert.equal(t.relevant, true);
});

test('Entity List addition naming SMIC → entity_list, relevant', () => {
  const t = tagDocument(
    doc({
      title: 'Addition of Entities to the Entity List',
      abstract: 'BIS adds Semiconductor Manufacturing International Corporation (SMIC) and subsidiaries in China…',
    }),
  );
  assert.equal(t.eventType, 'entity_list');
  assert.equal(t.direction, 'tightening');
  assert.equal(t.relevant, true);
});

test('Mixed add+remove Entity List rule → tightening, flagged mixed', () => {
  const t = tagDocument(
    doc({
      title:
        'Addition of Entities to the Entity List, Revision of Entry on the Entity List, and Removal of Entities From the Entity List',
      abstract: 'Entities in China, including SMIC…',
    }),
  );
  assert.equal(t.direction, 'tightening');
  assert.ok(t.firedRules.includes('dir_mixed_additions_dominant'));
  assert.equal(t.relevant, true);
});

test('Entity List addition for non-China, non-semis entities → not relevant', () => {
  const t = tagDocument(
    doc({ title: 'Addition of Entities to the Entity List', abstract: 'Entities in Russia and Belarus supporting the military…' }),
  );
  assert.equal(t.eventType, 'entity_list');
  assert.equal(t.relevant, false);
});

test('Entity List addition in China but not semis → not relevant for semis study', () => {
  const t = tagDocument(
    doc({ title: 'Addition of Entities to the Entity List', abstract: 'Entities in China implicated in human rights abuses in Xinjiang…' }),
  );
  assert.equal(t.chinaRelated, true);
  assert.equal(t.semisRelated, false);
  assert.equal(t.relevant, false);
});

test('USTR Section 301 exclusion extension → section_301_exclusion, not relevant', () => {
  const t = tagDocument(
    doc({
      agencies: ustr,
      type: 'Notice',
      title: "Notice of Product Exclusion Extensions: China's Acts, Policies, and Practices Related to Technology Transfer, Intellectual Property, and Innovation",
      action: 'Notice of product exclusion extensions.',
      abstract: 'In the Section 301 investigation of China…',
    }),
  );
  assert.equal(t.eventType, 'section_301_exclusion');
  assert.equal(t.relevant, false);
});

test('"Section 301" text from a non-USTR agency is not section_301', () => {
  const t = tagDocument(doc({ agencies: [{ slug: 'some-other-agency' }], title: 'Section 301 hearing on China' }));
  assert.equal(t.eventType, 'other');
  assert.equal(t.relevant, false);
});

// ── event time ────────────────────────────────────────────────────────────
test('publication 06:00 ET respects DST', () => {
  assert.equal(publicationInstant('2022-10-13').toISOString(), '2022-10-13T10:00:00.000Z'); // EDT
  assert.equal(publicationInstant('2023-01-10').toISOString(), '2023-01-10T11:00:00.000Z'); // EST
});

test('DST transition day (2024-03-10) resolves to EDT for 06:00', () => {
  assert.equal(zonedWallTimeToUtc('2024-03-10', 6, 0, 'America/New_York').toISOString(), '2024-03-10T10:00:00.000Z');
});

test('public inspection earlier than publication wins', () => {
  const r = earliestInstant('2022-10-13', '2022-10-07T15:15:00.000-04:00');
  assert.equal(r.source, 'public_inspection');
  assert.equal(r.instant.toISOString(), '2022-10-07T19:15:00.000Z');
});

test('missing / invalid / later PI falls back to publication', () => {
  assert.equal(earliestInstant('2022-10-13', null).source, 'publication_0600_et');
  assert.equal(earliestInstant('2022-10-13', 'garbage').source, 'publication_0600_et');
  assert.equal(earliestInstant('2022-10-13', '2022-10-14T12:00:00Z').source, 'publication_0600_et');
});

// ── FR client ─────────────────────────────────────────────────────────────
test('documents URL carries agency, types, date bounds, fields', () => {
  const u = new URL(buildDocumentsUrl({ agency: BIS_SLUG, types: ['RULE'], from: '2018-01-01', to: '2018-12-31' }));
  assert.equal(u.searchParams.get('conditions[agencies][]'), BIS_SLUG);
  assert.deepEqual(u.searchParams.getAll('conditions[type][]'), ['RULE']);
  assert.equal(u.searchParams.get('conditions[publication_date][gte]'), '2018-01-01');
  assert.ok(u.searchParams.getAll('fields[]').includes('abstract'));
});

test('piLookbackDates spans publication day and prior days across month boundary', () => {
  assert.deepEqual(piLookbackDates('2022-03-02', 3), ['2022-03-02', '2022-03-01', '2022-02-28', '2022-02-27']);
});

test('fetchAllDocuments paginates until total_pages', async () => {
  const calls: string[] = [];
  const fake = async (url: string) => {
    calls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    return { ok: true, status: 200, json: async () => ({ total_pages: 2, results: [doc({ document_number: `p${page}` })] }) };
  };
  const out = await fetchAllDocuments({ agency: BIS_SLUG, types: ['RULE'], from: '2020-01-01', to: '2020-12-31' }, fake, 0);
  assert.deepEqual(out.map((d) => d.document_number), ['p1', 'p2']);
  assert.equal(calls.length, 2);
});

test('fetchPublicInspectionDay is best-effort on HTTP error', async () => {
  const m = await fetchPublicInspectionDay('2022-10-07', async () => ({ ok: false, status: 500, json: async () => ({}) }));
  assert.equal(m.size, 0);
});

// ── record + csv ──────────────────────────────────────────────────────────
test('toEventRecord uses PI instant and records provenance', () => {
  const r = toEventRecord(
    doc({ title: 'Addition of Entities to the Entity List', abstract: 'SMIC in China' }),
    '2022-10-12T08:45:00-04:00',
  );
  assert.equal(r.eventTimeSource, 'public_inspection');
  assert.equal(r.publicInspectionAt, '2022-10-12T12:45:00.000Z');
  assert.equal(r.agency, BIS_SLUG);
});

test('csv escapes quotes, commas, newlines, arrays', () => {
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell(['x', 'y']), 'x|y');
  assert.equal(csvCell(null), '');
  const out = toCsv([toEventRecord(doc({ title: 'T, with comma' }), null)]);
  assert.equal(out.trim().split('\n').length, 2);
});

// ── tagger v2 (from real 2018–2026 backfill misclassifications) ───────────
test('Huawei TGL extension → tgl_extension, not relevant', () => {
  const t = tagDocument(doc({ title: 'Temporary General License: Extension of Validity', abstract: 'Huawei entities on the Entity List…' }));
  assert.equal(t.eventType, 'tgl_extension');
  assert.equal(t.relevant, false);
});

test('Public briefing / correction / comment-period docs → procedural', () => {
  for (const title of [
    'Procedures for Access to the Public Briefing on Additional Export Controls on Certain Advanced Computing and Semiconductor Manufacturing Items',
    'Addition of Certain Entities to the Entity List; Correction',
    'Export Controls on Semiconductor Manufacturing Items; Updates and Corrections; Extension of Comment Period',
  ]) {
    const t = tagDocument(doc({ title, abstract: 'China SMIC' }));
    assert.equal(t.eventType, 'procedural', title);
    assert.equal(t.relevant, false, title);
  }
});

test('"Corrections to Certain Existing Entries" inside an addition rule is not procedural', () => {
  const t = tagDocument(doc({ title: 'Addition of Entities to the Entity List; Corrections to Certain Existing Entries on the Entity List', abstract: 'entities in China' }));
  assert.equal(t.eventType, 'entity_list');
});

test('Dec-2024 FDPR/SME rule without "China" in abstract is still relevant', () => {
  const t = tagDocument(doc({ title: 'Foreign-Produced Direct Product Rule Additions, and Refinements to Controls for Advanced Computing and Semiconductor Manufacturing Items', abstract: 'certain destinations' }));
  assert.equal(t.eventType, 'advanced_computing_semis');
  assert.equal(t.relevant, true);
});

test('Section 301 tariff modification → section_301_action', () => {
  const t = tagDocument(doc({ agencies: ustr, type: 'Notice', title: "Notice of Modification of Section 301 Action: China's Acts, Policies, and Practices Related to Technology Transfer" }));
  assert.equal(t.eventType, 'section_301_action');
});

test('Entity List China rule: body naming YMTC makes it relevant; keyword alone does not', () => {
  const d0 = doc({ title: 'Additions and Revisions to the Entity List and Conforming Removal From the Unverified List', abstract: 'entities in China' });
  assert.equal(needsBodyScan(d0), true);
  assert.equal(tagDocument(d0).relevant, false);
  assert.equal(tagDocument(d0, { bodySemisHits: semisHitsFromBody('Yangtze Memory Technologies Co., Ltd., Wuhan') }).relevant, true);
  assert.equal(tagDocument(d0, { bodySemisHits: semisHitsFromBody('integrated circuits generally') }).relevant, false);
});

test('semisHitsFromBody maps names', () => {
  assert.deepEqual(semisHitsFromBody('… Semiconductor Manufacturing International Corporation (SMIC) …').slice(0, 1), ['SMIC']);
  assert.deepEqual(semisHitsFromBody('Moscow Institute of Physics'), []);
});

test('Oct-2023 "…; Updates and Corrections" rule stays substantive; Iran FDP rule is not semis', () => {
  const t = tagDocument(doc({ title: 'Implementation of Additional Export Controls: Certain Advanced Computing Items; Supercomputer and Semiconductor End Use; Updates and Corrections' }));
  assert.equal(t.eventType, 'advanced_computing_semis');
  assert.equal(tagDocument(doc({ title: 'Iran Foreign Direct Product Rule' })).eventType, 'export_control_other');
  assert.equal(tagDocument(doc({ title: 'X Controls; Corrections and Clarifications' })).eventType, 'procedural');
});

test('Aug-2020 Huawei affiliates rule mentioning TGL removal is entity_list, not tgl_extension', () => {
  const t = tagDocument(doc({ title: 'Addition of Huawei Non-U.S. Affiliates to the Entity List, the Removal of Temporary General License, and Amendments to General Prohibition Three (Foreign-Produced Direct Product Rule)' }));
  assert.equal(t.eventType, 'entity_list');
  assert.equal(t.relevant, true);
});

// ── shared collector (used by backfill script and cron route) ─────────────
import { collectFrEvents, yearRanges } from '../collect';

test('yearRanges splits inclusive bounds by calendar year', () => {
  assert.deepEqual(yearRanges('2025-11-01', '2026-02-10'), [['2025-11-01', '2025-12-31'], ['2026-01-01', '2026-02-10']]);
});

test('collectFrEvents: body scan + public-inspection time flow end to end (fake network)', async () => {
  const ymtcRule = doc({
    document_number: '2099-11111',
    title: 'Additions and Revisions to the Entity List',
    abstract: 'entities in China',
    publication_date: '2026-10-05',
    raw_text_url: 'https://example.test/raw/2099-11111.txt',
  });
  const noise = doc({ document_number: '2099-22222', title: 'Iran Foreign Direct Product Rule', publication_date: '2026-10-06' });
  const fetcher = async (url: string) => {
    const u = new URL(url);
    if (u.pathname.endsWith('/documents.json')) {
      const isBis = u.searchParams.get('conditions[agencies][]') === BIS_SLUG;
      return { ok: true, status: 200, json: async () => ({ total_pages: 1, results: isBis ? [ymtcRule, noise] : [] }) };
    }
    const day = u.searchParams.get('conditions[available_on]');
    const results = day === '2026-10-03' ? [{ document_number: '2099-11111', filed_at: '2026-10-03T08:45:00-04:00' }] : [];
    return { ok: true, status: 200, json: async () => ({ results }) };
  };
  const { records, piHits, bodyScanned } = await collectFrEvents({
    from: '2026-10-01',
    to: '2026-10-07',
    fetcher,
    fetchText: async () => 'Yangtze Memory Technologies Co., Ltd.',
    delayMs: 0,
  });
  assert.equal(bodyScanned, 1);
  const r = records.find((x) => x.externalId === '2099-11111')!;
  assert.equal(r.relevant, true);
  assert.equal(r.eventTimeSource, 'public_inspection');
  assert.equal(r.eventInstant, '2026-10-03T12:45:00.000Z');
  assert.equal(piHits, 1);
  assert.equal(records.find((x) => x.externalId === '2099-22222')!.relevant, false);
});
