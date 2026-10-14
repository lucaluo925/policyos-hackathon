import type { MonitorItem } from './query';
import { lexicalSimilarity, reportText } from './vendor/aihot-similarity';

export type EventLinkReason = 'same_document' | 'same_title' | 'similar_text';
export interface PolicyEvent {
  id: string;
  title: string;
  items: MonitorItem[];
  links: Array<{ from: string; to: string; reason: EventLinkReason }>;
}

const WINDOW_MS = 14 * 86_400_000;
const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const STOP = new Set('a an and are as at be by for from in is it of on or the to with government ministry announces announcement news update'.split(' '));
const terms = (text: string) => new Set(normalize(text).split(' ').filter(word => word.length > 2 && !STOP.has(word)));
const signature = (values: string[]) => [...new Set(values)].sort().join('|');

/** Discard tracking parameters only; policy/document identifiers remain distinct. */
function documentUrl(value: string | null): string | null {
  try {
    const url = new URL(value ?? '');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
}

function relation(a: MonitorItem, b: MonitorItem): EventLinkReason | null {
  if (a.provenance !== 'official_feed' || b.provenance !== 'official_feed') return null;
  const delta = Math.abs(Date.parse(a.publishedAt) - Date.parse(b.publishedAt));
  if (!Number.isFinite(delta) || delta > WINDOW_MS) return null;
  const url = documentUrl(a.url);
  if (url && url === documentUrl(b.url)) return 'same_document';
  // No cross-country/topic/language guesses from generic announcement titles.
  if (a.domain !== b.domain || !a.lang || a.lang !== b.lang || !a.countries.length ||
      signature(a.countries) !== signature(b.countries)) return null;
  const left = normalize(a.title), right = normalize(b.title);
  if (left.length < 35 || right.length < 35) return null;
  if (left === right) return 'same_title';
  // Different amounts, dates, section numbers or explicit negation must remain separate.
  if (signature(left.match(/\d+(?:[.,]\d+)*/g) ?? []) !== signature(right.match(/\d+(?:[.,]\d+)*/g) ?? [])) return null;
  if (/\b(no|not|without|never)\b|不|未|禁止/.test(left) !== /\b(no|not|without|never)\b|不|未|禁止/.test(right)) return null;
  const x = terms(left), y = terms(right);
  const shared = [...x].filter(term => y.has(term)).length;
  if (shared < 6 || shared / new Set([...x, ...y]).size < 0.7) return null;
  return lexicalSimilarity(reportText(left, a.description?.toLowerCase()), reportText(right, b.description?.toLowerCase())) >= 0.88
    ? 'similar_text' : null;
}

/** Deterministic candidate groups over the loaded batch. No providers, writes,
 * persistent event IDs or claim that textual similarity establishes one policy.
 * Require every pair to match, preventing a chain of weakly related headlines.
 */
export function aggregatePolicyEvents(items: MonitorItem[]): PolicyEvent[] {
  const unique = [...new Map(items.map(item => [item.id, item])).values()];
  const ordered = unique.sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || a.id.localeCompare(b.id));
  const groups: PolicyEvent[] = [];
  for (const item of ordered) {
    const group = groups.find(candidate => candidate.items.every(member => relation(member, item) !== null));
    if (!group) groups.push({ id: item.id, title: item.title, items: [item], links: [] });
    else {
      group.links.push({ from: group.items[0].id, to: item.id, reason: relation(group.items[0], item)! });
      group.items.push(item);
    }
  }
  return groups;
}

export function policyEventsJson(items: MonitorItem[], exportedAt = new Date().toISOString()): string {
  return JSON.stringify({ schemaVersion: 1, kind: 'policy_event_candidates', exportedAt,
    ruleVersion: 'lexical-candidates-v1', scope: 'loaded_announcements_only',
    notes: ['Groups are research leads, not verified policy identities or verdicts.',
      'Original titles, URLs, dates and provenance are preserved. No model or retrieval API is called by aggregation.',
      'Saved announcements are browser snapshots and may have changed at their source.'],
    events: aggregatePolicyEvents(items),
  }, null, 2) + '\n';
}
