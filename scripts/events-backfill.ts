/**
 * V12 — Backfill market-linkable policy events from the Federal Register.
 *
 *   npx tsx scripts/events-backfill.ts --from 2018-01-01 [--to 2026-09-21]
 *        [--out research/events/fr_events.csv] [--db] [--no-pi] [--pi-days 3]
 *
 * Sources: BIS rules (Entity List, advanced computing / semiconductor controls)
 * and USTR rules + notices (Section 301). Every document is written to the
 * CSV with its tags; `relevant=true` rows are candidates for the event study
 * and still need review (reviewStatus) before use.
 *
 * --db   also upserts into policy_events (requires DATABASE_URL + migration
 *        0009). Re-runs never overwrite reviewStatus / reviewNote.
 * --no-pi  skip public-inspection lookup (faster; every event then uses the
 *        conservative publication 06:00 ET time).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { collectFrEvents } from '../src/lib/events/collect';
import { upsertPolicyEvents } from '../src/lib/events/persist';
import { retryingFetcher } from '../src/lib/events/federal-register';
import { toCsv } from '../src/lib/events/csv';
import type { PolicyEventRecord } from '../src/lib/events/types';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

function loadDotenv(file: string) {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const k = line.slice(0, line.indexOf('=')).trim();
    let v = line.slice(line.indexOf('=') + 1).trim();
    if (/^(['"]).*\1$/.test(v)) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
}

const fetcher = retryingFetcher;

async function main() {
  const from = arg('from', '2018-01-01')!;
  const to = arg('to', new Date().toISOString().slice(0, 10))!;
  const out = arg('out', 'research/events/fr_events.csv')!;
  const usePi = !flag('no-pi');

  const { records, piHits } = await collectFrEvents({
    from,
    to,
    fetcher,
    usePi,
    piDays: Number(arg('pi-days', '3')),
    log: (m) => console.log(m),
  });

  mkdirSync(dirname(resolve(out)), { recursive: true });
  writeFileSync(out, toCsv(records));

  const rel = records.filter((r) => r.relevant);
  const by = (k: keyof PolicyEventRecord, rows = rel) =>
    rows.reduce<Record<string, number>>((m, r) => ((m[String(r[k])] = (m[String(r[k])] ?? 0) + 1), m), {});
  console.log(`\n[summary] documents=${records.length} relevant=${rel.length}`);
  console.log('[summary] relevant by eventType:', by('eventType'));
  console.log('[summary] relevant by direction:', by('direction'));
  console.log('[summary] relevant by year:', rel.reduce<Record<string, number>>((m, r) => ((m[r.publicationDate.slice(0, 4)] = (m[r.publicationDate.slice(0, 4)] ?? 0) + 1), m), {}));
  console.log(`[summary] public-inspection time found for ${piHits}/${rel.length} relevant events` + (usePi ? '' : ' (lookup skipped)'));
  console.log(`[summary] wrote ${out}`);

  if (flag('db')) {
    loadDotenv('.env.local');
    loadDotenv('.env');
    const { PrismaClient } = await import('@prisma/client');
    const prisma = new PrismaClient();
    try {
      const created = await upsertPolicyEvents(prisma, records);
      console.log(`[db] upserted ${records.length} policy_events (${created.length} new)`);
    } finally {
      await prisma.$disconnect();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
