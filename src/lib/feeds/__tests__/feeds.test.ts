import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyDomain } from '../classify';
import { FEED_REGISTRY, feedCountries, resolveFeedItem } from '../registry';

// Real titles seen in the feeds on 2026-09-22.
const cases: Array<[string, string | null]> = [
  ['Climate Week Keynote Address', 'climate'],
  ['Mehr Unabhängigkeit von fossilen Energien: Bundesumweltminister Schneider weiht in Hamburg größten deutschen Offshore-Windpark ein', 'climate'],
  ['200 Millionen Euro für den klimaangepassten Waldumbau', 'climate'],
  ['Freier Handel und Reformen für Wachstum und Wohlstand', 'trade'],
  ['Substantial agreement on EU-Philippines trade deal', 'trade'],
  ['Nu införs gemensamma migrationsregler för EU:s medlemsländer', 'immigration'],
  ['Canada advances trade talks on comprehensive economic partnership agreement with India', 'trade'],
  ['Sob coordenação federal, forças policiais fazem operação contra o crime organizado em presídios', null],
  ['Rádio Nacional transmite Corinthians x Fluminense pelo Brasileirão neste domingo (20)', null],
  ['Press conference - Apple Park, California', null],
  ['PETER OBI HAS NOWHERE TO HIDE OVER HIS POOR ANAMBRA RECORD', null],
  ['Bundeskanzler Merz telefoniert mit US-Präsident Trump', null],
  ['An important update on the programme', null], // "important" must not read as "import"
  ['Nachrichtendienstrecht wird reformiert', null],
  ['Federal government invests $2.6 million to support migratory bird monitoring and conservation programs', null],
  ['Government expands crackdown on knife crime', null],
];

test('classifyDomain on real titles', () => {
  for (const [title, want] of cases) assert.equal(classifyDomain(title), want, title);
});

test('every feed has a unique key, https-or-http URL and ISO2 countries', () => {
  const keys = new Set<string>();
  for (const f of FEED_REGISTRY) {
    assert.ok(!keys.has(f.key), f.key);
    keys.add(f.key);
    assert.match(f.url, /^https?:\/\//);
    for (const c of feedCountries(f)) assert.match(c, /^[A-Z]{2}$/);
  }
});

test('parser strips soft hyphens and escaped HTML', async () => {
  const { parseFeed } = await import('../atom-parser');
  const [e] = parseFeed('<rss><item><title>Ulrika Karlsson ny press\u00adchef</title><description>&lt;p&gt;Hej&lt;/p&gt;</description><link>https://x</link></item></rss>');
  assert.equal(e.title, 'Ulrika Karlsson ny presschef');
  assert.equal(e.summary, 'Hej');
  assert.equal(resolveFeedItem('se-migrationsverket', e.title, 'immigration'), null);
});

test('resolveFeedItem applies feed filters', () => {
  assert.equal(resolveFeedItem('jp-mof-news', 'Auction Result of 20-Year JGBs on September 15, 2026', 'trade'), null);
  assert.equal(
    resolveFeedItem('jp-mof-news', 'The Cabinet approved the Cabinet Order on Partially Amending Related Cabinet Orders for the Enforcement of the Act Partially Amending the FEFTA', 'trade'),
    'trade',
  );
  assert.equal(resolveFeedItem('se-migrationsverket', 'Eva Carlstedt tar över som ny kommunikationsdirektör', 'immigration'), null);
  assert.equal(resolveFeedItem('de-bundesregierung', 'Freier Handel und Reformen für Wachstum und Wohlstand', 'climate'), 'trade');
  assert.equal(resolveFeedItem('unknown-feed', 'anything', 'immigration'), 'immigration');
});
