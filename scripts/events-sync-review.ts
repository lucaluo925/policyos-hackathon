/**
 * Write human review decisions from research/events/review_v2.csv back to
 * policy_events.reviewStatus, so /api/events/export?approved=1 returns the
 * frozen v1 set.
 *
 *   npx tsx scripts/events-sync-review.ts [--file research/events/review_v2.csv] [--dry-run]
 *
 * keep → approved, drop → rejected. Only touches rows listed in the file;
 * the tagger-produced fields (direction, eventType, …) are left as-is — a
 * direction override from review is recorded in reviewNote instead.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function arg(name: string, fallback?: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

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

/** RFC-4180 CSV parser (quoted fields, escaped quotes, embedded newlines). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [header, ...body] = rows.filter((r) => r.length > 1 || r[0] !== '');
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

async function main() {
  const file = arg('file', 'research/events/review_v2.csv')!;
  const dry = process.argv.includes('--dry-run');
  const rows = parseCsv(readFileSync(file, 'utf8'));
  const updates = rows
    .filter((r) => r.externalId && (r.yourDecision === 'keep' || r.yourDecision === 'drop'))
    .map((r) => ({
      externalId: r.externalId,
      status: r.yourDecision === 'keep' ? ('approved' as const) : ('rejected' as const),
      note: [
        `review_v2: ${r.yourDecision}`,
        r.cluster && `cluster=${r.cluster}`,
        r.directionOverride && `directionOverride=${r.directionOverride}`,
        r.reason,
        r.decisionBy && `by ${r.decisionBy}`,
      ].filter(Boolean).join(' · '),
    }));
  const kept = updates.filter((u) => u.status === 'approved').length;
  console.log(`[review] ${updates.length} decisions in ${file} (approved=${kept}, rejected=${updates.length - kept})`);
  if (dry) {
    for (const u of updates) console.log(`  ${u.externalId} → ${u.status}`);
    return;
  }

  loadDotenv('.env.local');
  loadDotenv('.env');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient();
  try {
    let n = 0;
    const missing: string[] = [];
    for (const u of updates) {
      const res = await prisma.policyEvent.updateMany({
        where: { source: 'federal_register', externalId: u.externalId },
        data: { reviewStatus: u.status, reviewNote: u.note },
      });
      if (res.count) n += res.count;
      else missing.push(u.externalId);
    }
    console.log(`[review] updated ${n} policy_events` + (missing.length ? `; not found: ${missing.join(', ')}` : ''));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
