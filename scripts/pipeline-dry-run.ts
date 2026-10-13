/**
 * Exercise a pipeline's extraction and the new change-detection decisions
 * against the live source, without touching the database:
 *
 *   npx tsx scripts/pipeline-dry-run.ts [pipeline-key]
 *
 * Why this exists. The content-keyed dedup added on 2026-10-10 assumes that
 * two fetches of the same unchanged page produce an identical deepItemHash.
 * The unit tests only prove the hash is deterministic for identical input;
 * they cannot prove the pipeline *produces* identical input across runs. If
 * an item's extracted text carries anything volatile -- a rendered
 * timestamp, a rotating related-links block, a nonce that survives
 * normalisation -- every run hashes differently, the dedup never matches,
 * and the churn it was written to stop continues while the code looks
 * correct. Same question for the index signal.
 *
 * So this fetches each source twice and compares. It writes nothing.
 *
 * ONE LIMITATION, and it matters. This runs from wherever you run it, which
 * is not where the cron runs. On 2026-10-10 japan-trade failed here with 403
 * under every user-agent tried, including a browser one, while production
 * reported `success` for the same pipeline on the same day. METI is filtering
 * by network, not by user-agent. So a fetch failure here is NOT evidence of a
 * production failure, and the right next step is to look at what the run rows
 * actually say before touching a pipeline. (Do not answer a 403 by
 * impersonating a browser: that is circumventing an access control the site
 * is deliberately applying, and it would put the deployment's addresses at
 * risk of a harder block.)
 *
 * What this harness IS good for: hash and signal stability, extraction
 * counts, disposition tallies, and catching a seeded URL that yields nothing.
 */

import { deepItemHash } from '../src/lib/pipeline/helpers/deep-dedupe';
import { deepItemDisposition } from '../src/lib/pipeline/helpers/deep-disposition';
import { indexSignalUnchanged } from '../src/lib/pipeline/index-signal';
import { sha256 } from '../src/lib/pipeline/framework';
import { detectPolicyType } from '../src/lib/scoring/mapping';
import { listPipelines, getPipeline } from '../src/lib/pipeline/registry';
import { getCoverage } from '../src/lib/pipeline/coverage';
import type { DeepItem, PipelineDefinition, SourceContext } from '../src/lib/pipeline/framework';

// Read from PIPELINE_COVERAGE rather than keeping a second copy of the URLs
// here, which would silently drift from the one the cron actually uses.
function ctxFor(def: PipelineDefinition): SourceContext | null {
  const cov = getCoverage(def.key);
  if (!cov) return null;
  return {
    id: 'dry-run',
    countryIso: cov.countryIso,
    pipelineKey: def.key,
    sourceUrl: cov.sourceUrl,
    sourceName: cov.sourceName,
    domain: cov.domain as SourceContext['domain'],
    lastHash: null,
  };
}

interface Pass {
  rawLen: number;
  normLen: number;
  pageHash: string;
  signalText: string;
  items: DeepItem[];
  hashes: string[];
}

async function onePass(def: PipelineDefinition, ctx: SourceContext): Promise<Pass | string> {
  const fetched = await def.fetch(ctx);
  if (!fetched.ok) return `fetch failed (status ${fetched.status})`;
  const normalized = def.normalize(fetched.text);
  const signal = def.parse(normalized);
  const items = def.deepItems ? await def.deepItems(ctx, signal, normalized) : [];
  return {
    rawLen: fetched.text.length,
    normLen: normalized.length,
    pageHash: sha256(normalized),
    signalText: signal.extractedText ?? normalized.slice(0, 20_000),
    items,
    hashes: items.map(deepItemHash),
  };
}

async function main() {
  const only = process.argv[2];
  const defs = only ? [getPipeline(only)].filter(Boolean) as PipelineDefinition[] : listPipelines();

  for (const def of defs) {
    const ctx = ctxFor(def);
    if (!ctx) { console.log(`\n· ${def.key}: no dry-run URL registered, skipped`); continue; }
    console.log(`\n=== ${def.key}`);

    const a = await onePass(def, ctx);
    if (typeof a === 'string') { console.log(`  ✗ pass A: ${a}`); continue; }
    const b = await onePass(def, ctx);
    if (typeof b === 'string') { console.log(`  ✗ pass B: ${b}`); continue; }

    // "0 items" means two very different things, and conflating them is a
  // mistake already made once on canada-immigration: six of the thirteen
  // pipelines have no deepItems hook at all and keep a single meta-record of
  // an index page by design. Say which case this is.
  const kind = def.deepItems ? 'deep' : 'index-only (no deepItems hook, by design)';
  console.log(`  raw ${a.rawLen} -> normalised ${a.normLen} chars; ${a.items.length} deep items [${kind}]`);
    console.log(`  page hash stable across two fetches : ${a.pageHash === b.pageHash ? 'YES' : 'NO  <-- page churns per request'}`);
    console.log(`  index signal unchanged (A vs B)     : ${indexSignalUnchanged(a.signalText, b.signalText) ? 'YES' : 'NO  <-- signal is volatile'}`);

    if (a.items.length === 0) {
      console.log(def.deepItems
        ? '  !! has a deepItems hook and returned nothing -- extraction is broken'
        : '  (index-only pipeline: nothing to compare, as designed)');
      continue;
    }

    const same = a.hashes.filter((h, i) => h === b.hashes[i]).length;
    const verdict = same === a.items.length ? 'YES' : `NO  <-- ${a.items.length - same}/${a.items.length} differ, dedup WILL NOT match`;
    console.log(`  deepItemHash stable across fetches  : ${verdict}`);

    if (same !== a.items.length) {
      for (let i = 0; i < a.items.length; i++) {
        if (a.hashes[i] === b.hashes[i]) continue;
        const ia = a.items[i], ib = b.items[i];
        const field = (['url','title','summary','extractedText','policyType','guidanceType','effectiveDate'] as const)
          .filter((k) => String(ia[k] ?? '') !== String(ib[k] ?? ''));
        console.log(`     item ${i} "${(ia.title ?? '').slice(0, 50)}" differs in: ${field.join(', ') || 'numericValues'}`);
        for (const k of field.slice(0, 2)) {
          console.log(`        A.${k}: ${String(ia[k] ?? '').slice(0, 120)}`);
          console.log(`        B.${k}: ${String(ib[k] ?? '').slice(0, 120)}`);
        }
      }
    }

    const tally: Record<string, number> = {};
    for (const it of a.items) {
      const resolved = it.policyType ?? detectPolicyType(it.extractedText ?? it.title);
      const d = deepItemDisposition({ guidanceType: it.guidanceType, policyType: resolved });
      tally[d.changeType] = (tally[d.changeType] ?? 0) + 1;
    }
    console.log(`  disposition tally                   : ${JSON.stringify(tally)}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
