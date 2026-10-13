import type { PolicyEventRecord } from './types';

export const EVENT_CSV_COLUMNS: Array<keyof PolicyEventRecord> = [
  'source',
  'externalId',
  'agency',
  'docType',
  'publicationDate',
  'publicInspectionAt',
  'eventInstant',
  'eventTimeSource',
  'eventType',
  'chinaRelated',
  'semisRelated',
  'direction',
  'relevant',
  'taggerVersion',
  'title',
  'action',
  'htmlUrl',
  'firedRules',
];

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('|') : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: PolicyEventRecord[], extra: Record<string, string>[] = []): string {
  const header = [...EVENT_CSV_COLUMNS, 'reviewStatus', 'reviewNote'];
  const lines = [header.join(',')];
  rows.forEach((r, i) => {
    const cells = EVENT_CSV_COLUMNS.map((c) => csvCell(r[c]));
    cells.push(csvCell(extra[i]?.reviewStatus ?? 'pending'), csvCell(extra[i]?.reviewNote ?? ''));
    lines.push(cells.join(','));
  });
  return lines.join('\n') + '\n';
}
