'use client';

import Link from 'next/link';
import { truncateClaim } from '@/lib/verify/claim-text';
import { makeResearchLead, RESEARCH_LEAD_CHANGED, RESEARCH_LEAD_STORAGE_KEY } from '@/lib/intelligence/research-lead';

/**
 * Hands a claim to /verify, pre-filled.
 *
 * Used from the policy updates feed and from country pages, so the two cannot
 * drift apart in where they point or how they truncate.
 *
 * It pre-fills and does not auto-run. A verification spends real search and
 * model calls against a capped daily budget, so the visitor decides whether to
 * spend one — and arrives able to read the claim before starting.
 */
export function VerifyClaimLink({
  claim,
  label,
  className = '',
  sourceUrl,
}: {
  claim: string;
  label: string;
  className?: string;
  sourceUrl?: string | null;
}) {
  const verificationClaim = truncateClaim(claim);
  function rememberSource() {
    try {
      const lead = sourceUrl ? makeResearchLead({ claim: verificationClaim, sourceUrl }) : null;
      if (lead) sessionStorage.setItem(RESEARCH_LEAD_STORAGE_KEY, JSON.stringify(lead));
      else sessionStorage.removeItem(RESEARCH_LEAD_STORAGE_KEY);
      window.dispatchEvent(new Event(RESEARCH_LEAD_CHANGED));
    } catch { /* The checker remains usable when browser storage is unavailable. */ }
  }
  return (
    <Link
      href={`/verify?claim=${encodeURIComponent(verificationClaim)}`}
      onClick={rememberSource}
      className={`text-accent hover:underline ${className}`}
    >
      {label} &rarr;
    </Link>
  );
}
