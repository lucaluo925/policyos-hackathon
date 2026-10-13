/**
 * Minimal-pair probe for decomposition faithfulness.
 *
 * Pre-registered 2026-10-08 16:20 in the hackathon STATUS.md. Read that before
 * changing anything here: the metrics and the decision rule are fixed, and this
 * script only measures them.
 *
 * The question: does decompose drop the discriminating qualifier (usually a
 * year) from a claim, so that the adjudicator verifies a weaker proposition and
 * the roll-up reports support for something that was never checked?
 *
 * Why minimal pairs instead of hand-labelled ground truth: the claims are about
 * 2026 and any label we write is only as good as our own knowledge of 2026.
 * Instead every claim is paired with a variant that differs ONLY in the year,
 * chosen so the variant is false for structural reasons (the institution did
 * not exist yet). That half needs no world knowledge to label.
 *
 *   npm run verify:probe-faithfulness
 *   npm run verify:probe-faithfulness -- --out probe.json
 */

import { writeFileSync } from 'node:fs';
import { runVerification } from '@/lib/verify/pipeline';
import type { OverallVerdict, Verdict, VerificationResult } from '@/lib/verify/types';

interface Pair {
  id: string;
  /** The year that carries the discriminating force. */
  trueYear: string;
  absurdYear: string;
  /** Why the absurd variant is false regardless of anything after our cutoff. */
  absurdBecause: string;
  trueClaim: string;
  absurdClaim: string;
}

const PAIRS: Pair[] = [
  {
    id: 'cbam', trueYear: '2026', absurdYear: '1994',
    absurdBecause: 'CBAM did not exist; the EU had no carbon border mechanism',
    trueClaim: 'The EU carbon border adjustment mechanism began charging importers in 2026.',
    absurdClaim: 'The EU carbon border adjustment mechanism began charging importers in 1994.',
  },
  {
    id: 'entity-list', trueYear: '2026', absurdYear: '1985',
    absurdBecause: 'the Bureau of Industry and Security was created in 1987',
    trueClaim: 'The US Bureau of Industry and Security added new Chinese semiconductor firms to the Entity List in 2026.',
    absurdClaim: 'The US Bureau of Industry and Security added new Chinese semiconductor firms to the Entity List in 1985.',
  },
  {
    id: 'express-entry', trueYear: '2026', absurdYear: '1992',
    absurdBecause: 'Express Entry launched in 2015',
    trueClaim: 'Canada raised its Express Entry CRS cutoff above 500 in 2026.',
    absurdClaim: 'Canada raised its Express Entry CRS cutoff above 500 in 1992.',
  },
  {
    id: 'japan-visa', trueYear: '2026', absurdYear: '1960',
    absurdBecause: 'there was no such tourist visa regime between the two states then',
    trueClaim: 'Japan abolished its visa requirement for Chinese tourists in 2026.',
    absurdClaim: 'Japan abolished its visa requirement for Chinese tourists in 1960.',
  },
  {
    id: 'german-coal', trueYear: '2038', absurdYear: '1975',
    absurdBecause: 'a coal phase-out commitment dated 1975 is anachronistic',
    trueClaim: 'Germany committed to phasing out coal power by 2038.',
    absurdClaim: 'Germany committed to phasing out coal power by 1975.',
  },
  {
    id: 'brexit', trueYear: '2020', absurdYear: '1994',
    absurdBecause: 'the UK was a member and the EU itself was formed in 1993',
    trueClaim: 'The United Kingdom left the European Union in 2020.',
    absurdClaim: 'The United Kingdom left the European Union in 1994.',
  },
  {
    id: 'rare-earth', trueYear: '2026', absurdYear: '1970',
    absurdBecause: 'no rare earth magnet export control regime existed',
    trueClaim: 'India imposed export restrictions on rare earth magnets in 2026.',
    absurdClaim: 'India imposed export restrictions on rare earth magnets in 1970.',
  },
  {
    id: 'wto-ab', trueYear: '2026', absurdYear: '1948',
    absurdBecause: 'the WTO was founded in 1995',
    trueClaim: 'The WTO appellate body remained non-functional through 2026.',
    absurdClaim: 'The WTO appellate body remained non-functional through 1948.',
  },
];

/** Pre-registered: 3 absurd claims re-run once to size run-to-run noise. */
const NOOP_CONTROL_IDS = ['cbam', 'express-entry', 'wto-ab'];

/**
 * Pre-registered: the absurd half must not come back as any flavour of support.
 *
 * As written on 2026-10-08 this was ['supported', 'partially_supported'].
 * `partially_supported` was removed from the roll-up BECAUSE of this probe —
 * it was what three of the eight false claims came back as. The criterion is
 * unchanged in meaning; the fourth value simply no longer exists.
 */
const SUPPORTIVE: readonly OverallVerdict[] = ['supported'];

interface Run {
  pairId: string;
  side: 'true' | 'absurd';
  repeat: number;
  claim: string;
  expectedYear: string;
  ranAt: string;
  overall: OverallVerdict | 'ERROR';
  /**
   * Text AND verdict per assertion. The first version of this probe stored only
   * the text, which made it impossible to recompute a changed roll-up rule from
   * the recorded file — the one thing the file most needed to support, since
   * the roll-up is a pure function of these verdicts. Storing the verdict means
   * the next rule change costs zero API calls to evaluate.
   */
  assertions: Array<{ text: string; verdict: Verdict }>;
  /** Mechanism metric: did the claim's year survive into any assertion? */
  yearRetained: boolean;
  elapsedMs: number;
  errors: string[];
}

function argOf(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1]
    : fallback;
}

async function runOne(
  pair: Pair, side: 'true' | 'absurd', repeat: number,
): Promise<Run> {
  const claim = side === 'true' ? pair.trueClaim : pair.absurdClaim;
  const expectedYear = side === 'true' ? pair.trueYear : pair.absurdYear;
  const started = Date.now();
  const errors: string[] = [];
  let result: VerificationResult | null = null;

  try {
    for await (const ev of runVerification(claim)) {
      if (ev.type === 'error') errors.push(`${ev.stage}: ${ev.message}`);
      if (ev.type === 'done') result = ev.result;
    }
  } catch (e) {
    errors.push(`threw: ${(e as Error).message}`);
  }

  const assertions =
    result?.assertions.map((a) => ({ text: a.assertion.text, verdict: a.verdict })) ?? [];
  return {
    pairId: pair.id,
    side,
    repeat,
    claim,
    expectedYear,
    ranAt: new Date().toISOString(),
    overall: result?.overall ?? 'ERROR',
    assertions,
    yearRetained: assertions.some((a) => a.text.includes(expectedYear)),
    elapsedMs: result?.stats.elapsedMs ?? Date.now() - started,
    errors,
  };
}

async function main() {
  const out = argOf('out', 'src/lib/verify/probe-faithfulness.json');
  const runs: Run[] = [];

  const queue: Array<[Pair, 'true' | 'absurd', number]> = [];
  for (const p of PAIRS) {
    queue.push([p, 'true', 0]);
    queue.push([p, 'absurd', 0]);
  }
  for (const p of PAIRS.filter((x) => NOOP_CONTROL_IDS.includes(x.id))) {
    queue.push([p, 'absurd', 1]);
  }

  console.log(`${queue.length} runs (8 pairs + ${NOOP_CONTROL_IDS.length} no-op repeats)\n`);

  // Sequential on purpose. These runs are a measurement, so they must not
  // contend with each other for the same rate limit — a throttled run would be
  // recorded as a pipeline result. Promise.all would also interleave the
  // progress lines into something unreadable.

  for (const [i, [pair, side, repeat]] of queue.entries()) {
    process.stdout.write(
      `[${String(i + 1).padStart(2)}/${queue.length}] ${pair.id} ${side}${repeat ? ` (repeat ${repeat})` : ''} … `,
    );
    const run = await runOne(pair, side, repeat);
    runs.push(run);
    console.log(
      `${run.overall} | year ${run.expectedYear} ${run.yearRetained ? 'kept' : 'DROPPED'} | ` +
        `${run.assertions.length} assertion(s) | ${Math.round(run.elapsedMs / 1000)}s` +
        (run.errors.length ? ` | ${run.errors.length} error(s)` : ''),
    );
  }

  writeFileSync(out, `${JSON.stringify(runs, null, 2)}\n`, 'utf8');

  // ---- pre-registered metrics -------------------------------------------
  const firstPass = runs.filter((r) => r.repeat === 0);
  const absurd = firstPass.filter((r) => r.side === 'absurd');
  const truthy = firstPass.filter((r) => r.side === 'true');

  const errored = firstPass.filter((r) => r.overall === 'ERROR');
  const absurdScorable = absurd.filter((r) => r.overall !== 'ERROR');
  const absurdPassed = absurdScorable.filter(
    (r) => r.overall !== 'ERROR' && !SUPPORTIVE.includes(r.overall),
  );
  const yearKept = firstPass.filter((r) => r.yearRetained);
  const trueRefuted = truthy.filter((r) => r.overall === 'refuted');

  // no-op control: same input, second run, same verdict?
  const noopStable = NOOP_CONTROL_IDS.filter((id) => {
    const a = runs.find((r) => r.pairId === id && r.side === 'absurd' && r.repeat === 0);
    const b = runs.find((r) => r.pairId === id && r.side === 'absurd' && r.repeat === 1);
    return a && b && a.overall === b.overall;
  });

  console.log(`\n=== pre-registered metrics ===`);
  console.log(`primary   absurd half not "supported" : ${absurdPassed.length}/${absurdScorable.length}   (gate: >= 7/8)`);
  if (errored.length) {
    console.log(`          !! ${errored.length} run(s) errored and are EXCLUDED from the primary`);
    console.log(`             denominator above. A failed run is not a pass. If the gate is`);
    console.log(`             only met because of a shrunken denominator, the result does not count.`);
  }
  console.log(`secondary year retained in assertions : ${yearKept.length}/${firstPass.length}   (gate: >= 14/16)`);
  console.log(`guard     true half wrongly refuted   : ${trueRefuted.length}/${truthy.length}   (gate: 0)`);
  console.log(`control   no-op repeats stable        : ${noopStable.length}/${NOOP_CONTROL_IDS.length}   (< 2/3 invalidates the bench)`);

  const failures = absurd.filter(
    (r) => r.overall !== 'ERROR' && SUPPORTIVE.includes(r.overall),
  );
  if (failures.length) {
    console.log(`\nabsurd claims that came back supported — the defect, if it is real:`);
    for (const f of failures) {
      console.log(`  ${f.pairId} (${f.overall}) year ${f.expectedYear} ${f.yearRetained ? 'kept' : 'DROPPED'}`);
      f.assertions.forEach((a) => console.log(`      - [${a.verdict}] ${a.text}`));
    }
  }
  console.log(`\nwritten: ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
