import { truncateClaim } from '../verify/claim-text';

export interface ResearchClaim { claim: string; sourceUrl: string }

export const RESEARCH_LEAD_STORAGE_KEY = 'policyos:intelligence-source';
export const RESEARCH_LEAD_CHANGED = 'policyos:intelligence-source-changed';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
export interface ResearchLead extends ResearchClaim { selectedAt: string }
export interface BoundResearchLead { verificationClaim: string; lead: ResearchLead }

function readRecord(value: unknown, now: number): ResearchLead | null {
  if (!value || typeof value !== 'object') return null;
  const data = value as Record<string, unknown>;
  if (typeof data.claim !== 'string' || typeof data.sourceUrl !== 'string') return null;
  const claim = data.claim.trim();
  if (!claim || claim.length > 1000 || data.sourceUrl.length > 2048) return null;
  let source: URL;
  try { source = new URL(data.sourceUrl); } catch { return null; }
  if (!['http:', 'https:'].includes(source.protocol) || source.username || source.password) return null;
  const selected = { claim, sourceUrl: source.href };
  if (!selected || selected.sourceUrl.length > 2048 || typeof data.selectedAt !== 'string' || data.selectedAt.length > 32) return null;
  const selectedMs = Date.parse(data.selectedAt);
  if (!Number.isFinite(selectedMs) || selectedMs > now + 60_000 || now - selectedMs > MAX_AGE_MS) return null;
  return { ...selected, selectedAt: new Date(selectedMs).toISOString() };
}

export function makeResearchLead(selected: ResearchClaim, now = Date.now()): ResearchLead | null {
  return readRecord({ ...selected, selectedAt: new Date(now).toISOString() }, now);
}

/** The source travels with the link even when no click handler or storage runs.
 * An explicit empty source prevents stale session context from being inherited. */
export function verificationHref(claim: string, sourceUrl?: string | null): string {
  const text = truncateClaim(claim);
  const lead = sourceUrl ? makeResearchLead({ claim: text, sourceUrl }) : null;
  return `/verify?${new URLSearchParams({ claim: text, source: lead?.sourceUrl ?? '' })}`;
}

/** URL context is untrusted research context; it never supplies retrieval evidence. */
export function linkedResearchLead(claim: string, sourceUrl: string | null, now = Date.now()): ResearchLead | null {
  return sourceUrl ? makeResearchLead({ claim: truncateClaim(claim), sourceUrl }, now) : null;
}

export function readResearchLead(raw: string | null, expectedHeadline: string, now = Date.now()): ResearchLead | null {
  if (!raw || raw.length > 5000) return null;
  try {
    const lead = readRecord(JSON.parse(raw), now);
    return lead?.claim === expectedHeadline.trim() ? lead : null;
  } catch { return null; }
}

/** Capture context at run start; it is never retrieval evidence or a citation. */
export function bindResearchLead(lead: ResearchLead | null, verificationClaim: string, now = Date.now()): BoundResearchLead | null {
  const valid = readRecord(lead, now);
  const claim = verificationClaim.trim();
  return valid && claim && claim.length <= 1000 ? { verificationClaim: claim, lead: valid } : null;
}

/** A different completed claim must never inherit a previous run's lead. */
export function researchLeadForReport(bound: BoundResearchLead | null | undefined, completedClaim: string): ResearchLead | null {
  if (!bound || bound.verificationClaim !== completedClaim) return null;
  // Validate against the selection instant so a saved run does not expire on export.
  return readRecord(bound.lead, Date.parse(bound.lead.selectedAt));
}
