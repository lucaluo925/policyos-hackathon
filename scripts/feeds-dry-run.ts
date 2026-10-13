/**
 * Fetch every registered feed and show what would be kept, without touching
 * the database:  npx tsx scripts/feeds-dry-run.ts [feed-key]
 */
import { parseFeed } from '../src/lib/feeds/atom-parser';
import { FEED_REGISTRY, feedCountries, resolveFeedItem } from '../src/lib/feeds/registry';

async function main() {
  const only = process.argv[2];
  for (const f of FEED_REGISTRY.filter((x) => !only || x.key === only)) {
    try {
      const res = await fetch(f.url, {
        headers: { 'User-Agent': 'PolicyOS/4.0 (+https://policyos-one.vercel.app)' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) { console.log(`✗ ${f.key}: HTTP ${res.status}`); continue; }
      const entries = parseFeed(await res.text()).slice(0, 25);
      const kept = entries.map((e) => ({ e, d: resolveFeedItem(f.key, e.title, 'climate') })).filter((x) => x.d);
      console.log(`${kept.length ? '✓' : '·'} ${f.key} [${feedCountries(f).join(',')}]: ${kept.length}/${entries.length} kept`);
      for (const { e, d } of kept.slice(0, 6)) console.log(`    ${d?.padEnd(11)} ${e.publishedAt.slice(0, 10)}  ${e.title.slice(0, 110)}`);
    } catch (err) {
      console.log(`✗ ${f.key}: ${err instanceof Error ? err.message : err}`);
    }
  }
}
main();
