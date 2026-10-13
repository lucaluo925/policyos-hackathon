/**
 * Runs the real verification pipeline over a fixed claim set and writes a
 * private research record. The public /verify page uses claim starters only.
 *
 * Two jobs, one run:
 *   1. The same run was used for the pre-registered comparison between the two candidate
 *      decomposition models (see the hackathon STATUS.md, 2026-10-08 11:30).
 *      Running it through the real pipeline rather than a standalone copy
 *      matters: a comparison run on a copy measures the copy.
 *
 *   npm run verify:seed                    (default decomposer)
 *   npm run verify:seed -- --model ultra   (the other candidate)
 *   npm run verify:seed -- --out private/verify-recordings/custom.json
 *
 * Output is written as JSON in ignored private storage and is a record of real
 * runs with third-party excerpts. Never copy it into a public repository.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { runVerification } from '@/lib/verify/pipeline';
import type { EvidenceDoc, ScreenedDoc, VerificationResult } from '@/lib/verify/types';
import { isOfficialSource } from '@/lib/verify/sources';

const MODELS: Record<string, string> = {
  super: 'nvidia/nemotron-3-super-120b-a12b',
  ultra: 'nvidia/Nemotron-3-Ultra-550b-a55b',
};

/** Spread across the three domains PolicyOS tracks, with a mix of likely outcomes. */
const CLAIMS = [
  'The US Bureau of Industry and Security added new Chinese semiconductor firms to the Entity List in 2026.',
  'The EU carbon border adjustment mechanism began charging importers in 2026.',
  'Canada raised its Express Entry CRS cutoff above 500 in 2026.',
  'The UK scrapped its post-study work visa in 2026.',
  'Japan abolished its visa requirement for Chinese tourists in 2026.',
  'The United States rejoined the Paris Agreement in 2026.',
  'India imposed export restrictions on rare earth magnets in 2026.',
  'Australia introduced a carbon border tariff in 2026.',
  'Germany abandoned its coal phase-out commitment in 2026.',
  'The WTO appellate body remained non-functional through 2026.',
];


interface SeededExample {
  claim: string;
  ranAt: string;
  decomposeModel: string;
  result: VerificationResult;
  evidence: Record<string, EvidenceDoc[]>;
  screened: Record<string, ScreenedDoc[]>;
  /** Pre-registered comparison metrics, computed from this run. */
  metrics: {
    assertions: number;
    topRetrievalScore: number;
    officialSourceHits: number;
    elapsedMs: number;
  };
}

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const modelKey = arg('model', 'super');
  const decomposeModel = MODELS[modelKey] ?? modelKey;
  const out = arg('out', `private/verify-recordings/seeded-${modelKey}.json`);
  console.log(`decompose model: ${decomposeModel}\noutput: ${out}\n`);

  const examples: SeededExample[] = [];

  for (const [i, claim] of CLAIMS.entries()) {
    process.stdout.write(`[${i + 1}/${CLAIMS.length}] ${claim.slice(0, 62)}… `);
    const evidence: Record<string, EvidenceDoc[]> = {};
    const screened: Record<string, ScreenedDoc[]> = {};
    let result: VerificationResult | null = null;
    const errors: string[] = [];

    for await (const ev of runVerification(claim, { decomposeModel })) {
      if (ev.type === 'evidence') evidence[ev.assertionId] = ev.docs;
      if (ev.type === 'screened') screened[ev.assertionId] = ev.docs;
      if (ev.type === 'error') errors.push(`${ev.stage}: ${ev.message}`);
      if (ev.type === 'done') result = ev.result;
    }

    if (!result) {
      console.log(`FAILED — ${errors.join('; ').slice(0, 160)}`);
      continue;
    }

    const allDocs = Object.values(evidence).flat();
    const metrics = {
      assertions: result.assertions.length,
      topRetrievalScore: allDocs.length ? Math.max(...allDocs.map((d) => d.retrievalScore)) : 0,
      officialSourceHits: allDocs.filter((d) => isOfficialSource(d.url)).length,
      elapsedMs: result.stats.elapsedMs,
    };
    examples.push({
      claim,
      ranAt: new Date().toISOString(),
      decomposeModel,
      result,
      evidence,
      screened,
      metrics,
    });
    console.log(
      `${result.overall} | ${metrics.assertions} assertion(s) | top ${metrics.topRetrievalScore.toFixed(2)} | ` +
        `${metrics.officialSourceHits} official | ${Math.round(metrics.elapsedMs / 1000)}s` +
        (errors.length ? ` | ${errors.length} error(s)` : ''),
    );
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(examples, null, 2)}\n`, 'utf8');

  // Pre-registered metrics, printed so the comparison is not re-derived by eye.
  const n = examples.length;
  const mean = (f: (e: SeededExample) => number) =>
    n ? examples.reduce((a, e) => a + f(e), 0) / n : 0;
  console.log(`\n=== ${modelKey} — completed ${n}/${CLAIMS.length} ===`);
  console.log(`primary   mean top retrieval score : ${mean((e) => e.metrics.topRetrievalScore).toFixed(3)}`);
  console.log(`secondary mean official sources    : ${mean((e) => e.metrics.officialSourceHits).toFixed(2)}`);
  console.log(`tertiary  mean assertions          : ${mean((e) => e.metrics.assertions).toFixed(2)}`);
  console.log(`          mean elapsed             : ${Math.round(mean((e) => e.metrics.elapsedMs) / 1000)}s`);
  console.log(`          total elapsed            : ${Math.round(examples.reduce((a, e) => a + e.metrics.elapsedMs, 0) / 1000)}s`);
  const verdicts = examples.reduce<Record<string, number>>((a, e) => {
    a[e.result.overall] = (a[e.result.overall] ?? 0) + 1;
    return a;
  }, {});
  console.log(`          verdict mix              : ${JSON.stringify(verdicts)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
