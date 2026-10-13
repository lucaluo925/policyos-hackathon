/** Parser regression tests using self-authored public fixtures.
 * The private development checkout retains dated source captures for historical
 * diagnostics. These compact public fixtures test the same parser branches
 * without redistributing source-page HTML or claiming snapshot equivalence.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  dropTrailingPartialTag,
  inlineSummaryFrom,
  looksLikeNavLabel,
} from '../helpers/html-extractor';
import { extractUscisIndexItems } from '../pipelines/us-immigration';
import { extractIndexItems as extractUkItems } from '../pipelines/uk-climate';
import { extractIndexItems as extractEuItems } from '../pipelines/eu-trade';
import { extractIndexItems as extractDeItems } from '../pipelines/germany-climate';
import { extractIndexItems as extractCaItems } from '../pipelines/canada-immigration';

// The test runner transpiles to CJS, where `import.meta.dirname` is
// undefined, so the fixtures are resolved from the project root that
// `npm test` runs in.
const FIXTURE_DIR = join(process.cwd(), 'src', 'lib', 'pipeline', '__tests__', 'fixtures');
const fixture = (name: string) => readFileSync(join(FIXTURE_DIR, `${name}.html`), 'utf8');

type Item = { title: string; inlineSummary: string };

const PARSERS: Array<[string, () => Item[]]> = [
  ['us-immigration', () => extractUscisIndexItems(fixture('us-immigration'))],
  ['uk-climate', () => extractUkItems(fixture('uk-climate'))],
  ['eu-trade', () => extractEuItems(fixture('eu-trade'))],
  ['germany-climate', () => extractDeItems(fixture('germany-climate'))],
];

// ─── The two defects, held shut ───────────────────────────────────────────

for (const [name, run] of PARSERS) {
  test(`${name}: no parsed summary carries raw markup`, () => {
    for (const item of run()) {
      assert.ok(
        !item.inlineSummary.includes('<'),
        `${name}: summary for ${JSON.stringify(item.title)} contains a raw tag: ` +
          JSON.stringify(item.inlineSummary.slice(-80)),
      );
    }
  });

  test(`${name}: no navigation label is emitted as a policy`, () => {
    for (const item of run()) {
      assert.ok(
        !looksLikeNavLabel(item.title),
        `${name}: emitted navigation label as a policy: ${JSON.stringify(item.title)}`,
      );
    }
  });
}

// ─── Synthetic yield floors and navigation rejection ─────────────────────
// The US and EU samples carry test listings; UK and Germany carry navigation.
// These fixtures test parser behavior, not current live-source yield.

test('us-immigration: still reaches the updates listing', () => {
  const items = extractUscisIndexItems(fixture('us-immigration'));
  assert.ok(items.length >= 10, `expected >= 10 items, got ${items.length}`);
  // The synthetic updates cite a manual code; the navigation label does not.
  assert.ok(
    items.some((i) => /USCIS-PM/i.test(i.title)),
    'no item cited a USCIS-PM reference, which suggests the menu was parsed again',
  );
});

test('eu-trade: still reaches the news listing', () => {
  const items = extractEuItems(fixture('eu-trade'));
  assert.ok(items.length >= 4, `expected >= 4 items, got ${items.length}`);
});

// ─── Unit level ───────────────────────────────────────────────────────────

test('dropTrailingPartialTag removes a tag the slice cut in half', () => {
  assert.equal(dropTrailingPartialTag('Text here <div class="leftnav-me'), 'Text here ');
  assert.equal(dropTrailingPartialTag('<p>Whole</p>'), '<p>Whole</p>');
  assert.equal(dropTrailingPartialTag('no markup at all'), 'no markup at all');
});

test('inlineSummaryFrom budgets text rather than markup', () => {
  const html = '<a href="/x">Title</a><div class="wrapper-with-a-long-class-name">Body text follows here.</div>';
  const out = inlineSummaryFrom(html, 0, { maxChars: 40, windowChars: 60 });
  assert.ok(!out.includes('<'), `leaked markup: ${JSON.stringify(out)}`);
  assert.ok(out.length <= 40, `got ${out.length} chars`);
});

test('inlineSummaryFrom drops the title and date it was given', () => {
  const html = '<a href="/x">Grant scheme</a> <span>Grant scheme</span> April 2, 2026 <p>Real detail.</p>';
  const out = inlineSummaryFrom(html, 0, { maxChars: 200, drop: ['Grant scheme', 'April 2, 2026'] });
  assert.ok(out.includes('Real detail.'), out);
});

test('looksLikeNavLabel catches the shapes that reached the database', () => {
  for (const nav of [
    'Volume 2 - Nonimmigrants',
    'Chapter 4 - Adjudication procedures',
    'es español',
    'bg български',
    'EU Trade Newsletter - Subscribe',
    'Press Releases - Archive',
    'News and communications',
  ]) {
    assert.ok(looksLikeNavLabel(nav), `should be nav: ${nav}`);
  }
  for (const real of [
    'Substantial agreement on EU-Philippines trade deal',
    'UKAEA unveils 2026-2030 fusion roadmap',
    'Executive Order on Border Security',
    'National Carbon Emissions Trading Scheme',
  ]) {
    assert.ok(!looksLikeNavLabel(real), `should be real: ${real}`);
  }
});

test('summaries decode numeric character references', () => {
  // The EU site writes apostrophes as `&#039;`, which the named-entity list
  // did not cover, so "the EU&#039;s network" reached the page as written.
  const out = inlineSummaryFrom('<p>the EU&#039;s network &amp; its reach</p>', 0, { maxChars: 80 });
  assert.equal(out, "the EU's network & its reach");
});

test('an escaped entity is not decoded twice', () => {
  const out = inlineSummaryFrom('<p>write &amp;#39; for an apostrophe</p>', 0, { maxChars: 80 });
  assert.equal(out, 'write &#39; for an apostrophe');
});

test('looksLikeNavLabel also catches bare section labels and page titles', () => {
  // Found on the deployed page after the first cleanup: a bare "News"
  // section label, and an anchor that had wrapped a document title.
  for (const nav of ['News', 'Presse', 'Newsletter', 'Presse | Ministères Aménagement du territoire']) {
    assert.ok(looksLikeNavLabel(nav), `should be nav: ${nav}`);
  }
  for (const real of [
    'News rules for energy bills announced',
    'EU and Mexico deepen long-term ties at a historic summit',
  ]) {
    assert.ok(!looksLikeNavLabel(real), `should be real: ${real}`);
  }
});

// ─── uk-climate now reads the department's Atom feed ──────────────────────
//
// Unlike the four .html fixtures, this one is CONSTRUCTED rather than
// captured: the live feed could not be written to disk from here, so it is
// assembled from fields read off the real feed on 2026-10-10 — real
// headlines, real article URLs, real timestamps, real entity escapes — in
// the element shape that feed actually uses (<entry>, <link rel="alternate"
// type="text/html" href>, <title>, <summary>, <updated>). The live feed
// carried 20 entries in exactly this shape.

test('uk-climate reads items from the DESNZ Atom feed', () => {
  const items = extractUkItems(
    readFileSync(join(FIXTURE_DIR, 'uk-climate-feed.atom'), 'utf8'),
  );
  assert.equal(items.length, 3);
  assert.deepEqual(
    items.map((i) => i.title),
    [
      'Drivers set to save as petrol prices launch on Google Maps',
      'UK’s decommissioning mission continues to expand',
      'Great British Grid to speed up connections and cut bills',
    ],
  );
  // Absolute article URLs, so the deep fetcher can follow them unchanged.
  for (const item of items) {
    assert.ok(
      item.url.startsWith('https://www.gov.uk/government/news/'),
      `not an article URL: ${item.url}`,
    );
    assert.ok(!item.inlineSummary.includes('<'), item.inlineSummary);
    assert.ok(item.inlineSummary.length > 0, `empty summary for ${item.title}`);
  }
  // Entities decode, including the pound sign the summaries escape.
  assert.ok(items[2].inlineSummary.includes('£64m'), items[2].inlineSummary);
});

test('uk-climate still falls back to an HTML listing for a non-feed source', () => {
  // This self-authored non-feed page pins the HTML fallback branch.
  const items = extractUkItems(fixture('uk-climate'));
  assert.equal(items.length, 0);
});

// ─── germany-climate now reads the ministry's English RSS ─────────────────
//
// Constructed from the live feed the same way the UK one was, and for the
// same reason: real headlines, links, pubDates and entity escapes read off
// https://www.bundesumweltministerium.de/en/meldungen.rss on 2026-10-10,
// in the RSS 2.0 shape it actually uses. The live feed carried 20 items.
//
// The self-authored HTML fixture below checks navigation rejection only.
// It does not prove current live ministry-page yield.

test('germany-climate reads items from the BMUKN English RSS feed', () => {
  const items = extractDeItems(
    readFileSync(join(FIXTURE_DIR, 'germany-climate-feed.rss'), 'utf8'),
  );
  assert.equal(items.length, 3);
  assert.equal(
    items[0].title,
    'Preparations for the UN Climate Change Conference: Pre-COP31 taking place in Fiji',
  );
  for (const item of items) {
    assert.ok(
      item.url.startsWith('https://www.bundesumweltministerium.de/en/pressrelease/'),
      `not a press-release URL: ${item.url}`,
    );
    assert.ok(!item.inlineSummary.includes('<'), item.inlineSummary);
    assert.ok(item.inlineSummary.length > 0, `empty summary for ${item.title}`);
    assert.ok(!looksLikeNavLabel(item.title), `read as navigation: ${item.title}`);
  }
  // RSS 2.0, so this exercises parseFeed's <item>/<description>/<pubDate>
  // branch rather than the Atom one the UK feed uses.
  assert.ok(items[2].inlineSummary.includes("Germany's"), items[2].inlineSummary);
});

test('germany-climate still falls back to the HTML path for a non-feed source', () => {
  // This self-authored navigation-only page pins the HTML fallback branch.
  const items = extractDeItems(fixture('germany-climate'));
  assert.equal(items.length, 0);
});

// ─── canada-immigration now reads the Government of Canada news API ──────
//
// Constructed like the UK and German feed fixtures, from fields read off
// the live endpoint on 2026-10-10, which returned 25 entries. Note the
// link element here carries no rel attribute — `<link href="…"/>` — so
// this pins extractLinkHref's second branch, where the UK feed uses
// rel="alternate" and the German one uses RSS <link>text</link>.

test('canada-immigration reads items from the Canada news API feed', () => {
  const items = extractCaItems(
    readFileSync(join(FIXTURE_DIR, 'canada-immigration-feed.atom'), 'utf8'),
  );
  assert.equal(items.length, 3);
  assert.match(items[0].title, /Productivity Mega Deduction/);
  for (const item of items) {
    assert.ok(
      item.url.startsWith('https://www.canada.ca/en/immigration-refugees-citizenship/news/'),
      `not a news URL: ${item.url}`,
    );
    assert.ok(!item.inlineSummary.includes('<'), item.inlineSummary);
    assert.ok(item.inlineSummary.length > 0, `empty summary for ${item.title}`);
  }
  assert.ok(items[1].inlineSummary.includes('Canada’s'), items[1].inlineSummary);
});

test('canada-immigration yields nothing from a page that is not a feed', () => {
  // The HTML page it used to watch still answers 200 but carries no
  // article links, which is why a meta-record was all it ever produced.
  assert.deepEqual(extractCaItems('<html><body><a href="/x">Immigration</a></body></html>'), []);
});
