import { earliestInstant } from './event-time';
import { TAGGER_VERSION, tagDocument } from './tagger';
import type { FrDocument, PolicyEventRecord } from './types';

export function toEventRecord(
  doc: FrDocument,
  piFiledAt: string | null,
  bodySemisHits: string[] = [],
): PolicyEventRecord {
  const tags = tagDocument(doc, { bodySemisHits });
  const { instant, source } = earliestInstant(doc.publication_date, piFiledAt);
  const agency =
    (doc.agencies ?? []).map((a) => a.slug || a.raw_name || a.name).filter(Boolean).join(';') || 'unknown';
  return {
    ...tags,
    source: 'federal_register',
    externalId: doc.document_number,
    agency,
    docType: doc.type,
    title: doc.title,
    action: doc.action ?? null,
    abstract: doc.abstract ?? null,
    htmlUrl: doc.html_url,
    publicationDate: doc.publication_date,
    publicInspectionAt: source === 'public_inspection' ? instant.toISOString() : null,
    eventInstant: instant.toISOString(),
    eventTimeSource: source,
    taggerVersion: TAGGER_VERSION,
  };
}
