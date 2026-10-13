/**
 * Headless smoke run of the verification pipeline — no Next.js, no database.
 *
 * Exists so the pipeline can be exercised and judged before any UI exists,
 * and so a failure can be attributed to the pipeline rather than to rendering.
 *
 *   npm run verify:smoke -- "your claim here"
 *   npm run verify:smoke                      (uses the default claim)
 *   npm run verify:smoke -- --inspect-sources "your claim here"
 *   npm run verify:smoke -- --persist "claim" (also write to the review queue)
 *
 * --persist is opt-in because it writes rows to the real database. Without it
 * this script is read-only apart from the API calls it makes.
 * Set POLICYOS_SMOKE_RESULT_PATH to create a private, full result JSON file
 * without overwriting prior runs; it may contain third-party excerpts.
 */

import { runVerification } from '@/lib/verify/pipeline';
import { persistVerification } from '@/lib/verify/review-sink';
import { writeFile } from 'node:fs/promises';

const DEFAULT_CLAIM =
  'The US Bureau of Industry and Security added new Chinese semiconductor ' +
  'firms to the Entity List in 2026.';

async function main() {
  const argv = process.argv.slice(2);
  const persist = argv.includes('--persist');
  const inspectSources = argv.includes('--inspect-sources');
  const claim = argv.filter((a) => a !== '--persist' && a !== '--inspect-sources').join(' ').trim() || DEFAULT_CLAIM;
  console.log(`CLAIM: ${claim}${persist ? '  [--persist]' : ''}${inspectSources ? '  [--inspect-sources]' : ''}\n`);
  let hadError = false;
  let completed = false;

  for await (const ev of runVerification(claim, { inspectSources })) {
    switch (ev.type) {
      case 'stage':
        console.log(
          `[${ev.status === 'start' ? '>' : '<'}] ${ev.stage}` +
            (ev.detail ? ` — ${ev.detail}` : ''),
        );
        break;
      case 'assertions':
        for (const a of ev.assertions) console.log(`    ${a.id}: ${a.text}`);
        break;
      case 'evidence':
        for (const d of ev.docs) {
          console.log(`    [${d.retrievalScore.toFixed(2)}] ${d.title.slice(0, 70)}`);
          console.log(`           ${d.url}`);
        }
        console.log(`    tavily request_id: ${ev.tavilyRequestId}`);
        break;
      case 'screened':
        for (const d of ev.docs) {
          console.log(
            `    ${d.relevant ? 'KEEP' : 'drop'} ${d.leaning.padEnd(8)} ${d.url.slice(0, 80)}`,
          );
        }
        break;
      case 'verdict':
        console.log(
          `    => ${ev.result.verdict.toUpperCase()} (confidence ${ev.result.confidence}` +
            `${ev.result.conflicted ? ', CONFLICTED' : ''})`,
        );
        console.log(`       ${ev.result.rationale.slice(0, 300)}`);
        for (const u of ev.result.citedUrls) console.log(`       cited: ${u}`);
        break;
      case 'error':
        hadError = true;
        console.error(`    !! ${ev.stage}: ${ev.message}`);
        break;
      case 'done': {
        completed = true;
        if (process.env.POLICYOS_SMOKE_RESULT_PATH) {
          await writeFile(process.env.POLICYOS_SMOKE_RESULT_PATH,
            JSON.stringify(ev.result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
        }
        console.log(`\nOVERALL: ${ev.result.overall.toUpperCase()}`);
        console.log('STATS:', JSON.stringify(ev.result.stats));
        console.log('tavily request ids:', ev.result.tavilyRequestIds.join(', '));
        if (persist) {
          const out = await persistVerification(ev.result);
          if (out.skipped) {
            console.log(`\nPERSIST SKIPPED: ${out.skipped}`);
          } else {
            console.log('\nREVIEW QUEUE:');
            for (const p of out.persisted) {
              console.log(`  ${p.assertionId} -> item ${p.reviewItemId}`);
              console.log(`     stored confidence: ${p.storedConfidence}`);
              console.log(`     can change a score: ${p.gate.canChangeScore}`);
              console.log(`     gate: ${p.gate.reason}`);
            }
          }
        }
        break;
      }
    }
  }
  if (!completed || hadError) {
    throw new Error(completed ? 'Verification completed with stage errors.' : 'Verification ended without a result.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
