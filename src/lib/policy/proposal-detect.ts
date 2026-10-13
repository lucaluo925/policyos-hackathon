/**
 * Is this text about a *proposed* instrument, rather than one in force?
 *
 * Both policy-type classifiers used to answer this with a bare keyword list:
 *
 *   /\b(draft|proposed|proposal|consultation|green paper|white paper|...)\b/
 *
 * which reads any occurrence of "draft" or "proposed" as a draft policy. Run
 * against the real USCIS policy manual on 2026-10-10, that labelled
 *
 *   "USCIS-PM B.6 - Chapter 6 - Submitting Requests"   policyType: proposal
 *
 * a live operational-guidance chapter, because it explains six times over that
 * users may save *draft benefit requests* in their online account. For an
 * immigration product this is not a corner case: USCIS text is full of
 * "proposed employment", "proposed beneficiary" and "proposed endeavor", none
 * of which is a proposed policy.
 *
 * The word alone cannot carry the meaning, so match the instrument instead:
 * "proposed rule", "draft regulation", "notice of proposed rulemaking",
 * "proposal for a Regulation" -- the EU's own formula -- and the consultation
 * vocabulary that actually marks a document as not yet in force.
 *
 * One home for the predicate, because the two classifiers had drifted already
 * (the deep extractor had "for comment", the mapper did not).
 */

const INSTRUMENT = String.raw`(?:rule|rules|rulemaking|regulation|regulations|directive|decision|decree|order|law|act|bill|legislation|statute|amendment|amendments|guidance|policy|policies|standard|standards|text|measure|measures)`;

const PROPOSAL_PATTERNS: RegExp[] = [
  // US federal practice: the actual term of art, and its abbreviation.
  /\bnotice of proposed rulemaking\b/i,
  /\bnprm\b/i,
  /\badvance notice of proposed rulemaking\b/i,
  // "proposed rule", "draft regulation", "proposed amendments to ..."
  new RegExp(String.raw`\b(?:proposed|draft)\s+${INSTRUMENT}\b`, 'i'),
  // EU's own wording: "Proposal for a Regulation of the European Parliament".
  new RegExp(String.raw`\bproposal\s+for\s+(?:a|an|the)\s+${INSTRUMENT}\b`, 'i'),
  /\blegislative proposal\b/i,
  /\bpolicy proposal\b/i,
  // Consultation vocabulary: a document open for comment is not in force.
  /\bpublic consultation\b/i,
  /\bconsultation (?:on|document|paper|period|response|outcome)\b/i,
  /\bopen (?:for|to) (?:public )?(?:comment|comments|consultation)\b/i,
  /\brequest for comments?\b/i,
  /\bcall for (?:evidence|input|views)\b/i,
  /\bcomment period\b/i,
  /\bhas been proposed\b/i,
  // Named instrument kinds that are proposals by definition.
  /\bgreen paper\b/i,
  /\bwhite paper\b/i,
  /\bbill (?:introduced|was introduced)\b/i,
  /\bintroduced a bill\b/i,
  /\bexposure draft\b/i,
];

/** True when the text marks an instrument as proposed rather than in force. */
export function looksLikeProposal(text: string): boolean {
  if (!text) return false;
  return PROPOSAL_PATTERNS.some((re) => re.test(text));
}
