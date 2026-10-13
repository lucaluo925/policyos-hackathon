/**
 * Turning things in the product into claims the verifier can check.
 *
 * A policy's *name* is not a claim — "Inflation Reduction Act" has no truth
 * value and would send the pipeline looking for nothing in particular. What
 * is checkable is the sentence describing what the policy does, which is
 * where the numbers live: a dollar figure, a percentage, a deadline. So a
 * policy becomes a claim by pairing its name with that description, and the
 * country name is kept in front because policy names collide across
 * jurisdictions.
 *
 * English is used regardless of the interface language. The decomposer,
 * screener and adjudicator prompts are English and retrieval is English, so
 * handing them a localised string would degrade the search for no benefit.
 */

/**
 * Longest claim the API accepts. Defined once here: it was previously
 * duplicated in the route and the page, with a comment in the page admitting
 * the two had to be kept in step by hand.
 */
export const CLAIM_MAX_LENGTH = 500;

/** Trim to the limit on a word boundary. No ellipsis — it would be read as part of the claim. */
export function truncateClaim(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= CLAIM_MAX_LENGTH) return trimmed;
  const cut = trimmed.slice(0, CLAIM_MAX_LENGTH);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > CLAIM_MAX_LENGTH * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * A policy record as a checkable claim.
 *
 * @param countryName English country name
 * @param title       English policy title
 * @param description English description; omitted when the record has none,
 *                    which leaves a weaker claim but still a locatable one
 */
export function policyClaim(
  countryName: string,
  title: string,
  description?: string | null,
): string {
  const body = description?.trim()
    ? `${countryName} — ${title}: ${description.trim()}`
    : `${countryName} — ${title}`;
  return truncateClaim(body);
}
