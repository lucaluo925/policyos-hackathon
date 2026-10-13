import type { Assertion } from './types';

type SearchAssertion = Assertion & { searchQuery: string };

const SCOPE_MARKER = /\b(?:including|excluding|except(?: for)?|unless|regardless of)\s+([^,.;]+)/gi;
const YEAR = /\b(?:19|20)\d{2}\b/g;
const FILLER = new Set(['about', 'after', 'before', 'during', 'every', 'their', 'these', 'those', 'under', 'which', 'while', 'with', 'without']);

function terms(value: string): Set<string> {
  return new Set((value.toLowerCase().replace(/[-–]/g, ' ').match(/[a-z]{4,}/g) ?? [])
    .filter(word => !FILLER.has(word))
    .map(word => word.endsWith('ss') ? word : word.replace(/(?:es|s)$/, '')));
}

/**
 * A conjunction of true fragments can be false when its subject/date relation
 * is false. If the model separates an explicit scope exception from a year,
 * check the original proposition as one assertion instead of changing it.
 */
export function preserveScopeDateRelation(claim: string, assertions: SearchAssertion[]): SearchAssertion[] {
  const years = [...new Set(claim.match(YEAR) ?? [])];
  if (years.length === 0) return assertions;
  const scopes = [...claim.matchAll(SCOPE_MARKER)]
    .map(match => terms(match[1].split(/\b(?:from|since|on|by)\s+(?=\d)/i)[0]))
    .filter(scope => scope.size > 0);
  if (scopes.length === 0) return assertions;
  const relationPreserved = scopes.every(scope => years.every(year => assertions.some(assertion => {
    if (!assertion.text.includes(year)) return false;
    const assertionTerms = terms(assertion.text);
    return [...scope].every(term => assertionTerms.has(term));
  })));
  return relationPreserved ? assertions : [{ id: 'a1', text: claim, searchQuery: claim }];
}

/** A model may spend its assertion budget on earlier dates and silently omit
 * a later target or exception year. In that case the conjunction no longer
 * represents the original claim, even when every generated assertion is true.
 * Keep the whole claim checkable rather than awarding a partial check a full
 * supported verdict. A year in a search query does not count: the adjudicator
 * judges assertion text, not the query. */
export function preserveClaimYears(claim: string, assertions: SearchAssertion[]): SearchAssertion[] {
  const claimYears = new Set(claim.match(YEAR) ?? []);
  if (!claimYears.size) return assertions;
  const assertionYears = new Set(assertions.flatMap(assertion => assertion.text.match(YEAR) ?? []));
  return [...claimYears].every(year => assertionYears.has(year))
    ? assertions : [{ id: 'a1', text: claim, searchQuery: claim }];
}

/** "Such applicants" in a later assertion depends on a group defined in an
 * earlier assertion. The model judges each assertion independently, so the
 * later one is not checkable without the original qualifier. Keep the whole
 * proposition together when the reference omits one of its policy years. */
export function preserveIndependentReferents(claim: string, assertions: SearchAssertion[]): SearchAssertion[] {
  if (assertions.length < 2) return assertions;
  const years = [...new Set(claim.match(YEAR) ?? [])];
  if (!years.length) return assertions;
  const dependent = assertions.some(assertion =>
    (/\b(?:such|these|those)\b/i.test(assertion.text) ||
      /^The (?:exemption|exception|rule|policy)\b/i.test(assertion.text)) &&
    years.some(year => !assertion.text.includes(year)));
  return dependent ? [{ id: 'a1', text: claim, searchQuery: claim }] : assertions;
}

/** An entitlement under a dated contract cannot be split into a general
 * entitlement and a separate true contract fact. The general entitlement may
 * be false even when the original conditional claim is true. If any generated
 * entitlement assertion drops that contract, check the original proposition
 * as one unit rather than changing the question the user asked. */
export function preserveDatedContractEligibility(
  claim: string, assertions: SearchAssertion[],
): SearchAssertion[] {
  if (!/\bcontract\b[^.;]{0,80}\b(?:before|on or before)\s+\d{1,2}\s+[a-z]+\s+(?:19|20)\d{2}\b/i.test(claim)) {
    return assertions;
  }
  const entitlement = /\b(?:qualif(?:y|ies)|eligib(?:le|ility)|exempt(?:ion)?|credit|refund)\b/i;
  const broadened = assertions.some(assertion =>
    entitlement.test(assertion.text) && !/\bcontract\b/i.test(assertion.text));
  return broadened ? [{ id: 'a1', text: claim, searchQuery: claim }] : assertions;
}
