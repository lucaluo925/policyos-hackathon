/** Conservative lexical retrieval hints, not a test of truth or entailment.
 * Missing a phrase triggers a bounded search; matching it never approves a
 * verdict. No jurisdiction, answer, date or source URL is supplied here. */
export function claimQualifiers(text: string): string[] {
  const phrases: string[] = [];
  // Preserve both members of a coordinated category (including hyphenated
  // categories). A broad summary about just one member is not full coverage.
  for (const match of text.matchAll(/\b([a-z][a-z-]{2,})\s+and\s+([a-z][a-z-]{2,})\b/gi)) {
    phrases.push(match[1], match[2]);
  }
  for (const match of text.matchAll(/\bsubject to\s+([A-Z]{2,8})\b/g)) phrases.push(match[1]);
  for (const match of text.matchAll(/\bdate of (?:issue|approval|application|entry|expiry)\b/gi)) {
    phrases.push(match[0]);
  }
  return [...new Set(phrases.map(phrase => phrase.toLowerCase()))];
}

function hasPhrase(passage: string, phrase: string): boolean {
  return new RegExp(`\\b${phrase.replace(/ /g, '\\s+')}s?\\b`, 'i').test(passage);
}

export function missingQualifiers(assertion: string, passage: string): string[] {
  return claimQualifiers(assertion).filter(phrase => !hasPhrase(passage, phrase));
}

export function qualifierSearchQuery(query: string, assertion: string): string {
  const missing = missingQualifiers(assertion, query);
  // Quoting a possibly false duration can exclude the correcting source.
  // When repairing an incomplete query, use ordinary unquoted search terms.
  if (!missing.length) return query;
  const neutral = query.replace(/["“”]/g, '').replace(
    /\bvalid\s+for\s+(?:\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:days?|months?|years?)\b/gi,
    'validity period',
  );
  return `${neutral} ${missing.join(' ')}`;
}

export function scopedHitAddsQualifier(assertion: string, existing: string, scoped: string): boolean {
  return missingQualifiers(assertion, existing).some(phrase => hasPhrase(scoped, phrase));
}
