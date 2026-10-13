/**
 * Market-linkable policy events (V12).
 *
 * A PolicyEvent answers one question the rest of PolicyOS does not:
 * "at what instant could a market participant first have read this?"
 * Everything downstream (event-day alignment, CAR) depends on that instant,
 * so every field that feeds it carries its provenance.
 */

export type EventType =
  | 'entity_list'
  | 'advanced_computing_semis'
  | 'section_301_action' // tariff action / modification / determination
  | 'section_301_exclusion' // exclusions, extensions, comment requests, procedures
  | 'tgl_extension' // Huawei temporary general license renewals
  | 'procedural' // briefings, corrections, comment-period extensions
  | 'export_control_other'
  | 'other';

export type EventDirection = 'tightening' | 'easing' | 'unclear';

export type EventTimeSource = 'public_inspection' | 'publication_0600_et';

/** Raw document as returned by the Federal Register documents API (subset). */
export interface FrDocument {
  document_number: string;
  title: string;
  type: string; // "Rule" | "Proposed Rule" | "Notice" | ...
  action?: string | null;
  abstract?: string | null;
  publication_date: string; // YYYY-MM-DD
  html_url: string;
  raw_text_url?: string | null;
  agencies?: Array<{ slug?: string; name?: string; raw_name?: string }>;
}

export interface TagResult {
  eventType: EventType;
  chinaRelated: boolean;
  semisRelated: boolean;
  direction: EventDirection;
  relevant: boolean;
  /** Names of the rules that fired, for audit / review. */
  firedRules: string[];
}

export interface PolicyEventRecord extends TagResult {
  source: 'federal_register';
  externalId: string;
  agency: string;
  docType: string;
  title: string;
  action: string | null;
  abstract: string | null;
  htmlUrl: string;
  publicationDate: string; // YYYY-MM-DD
  publicInspectionAt: string | null; // ISO UTC
  eventInstant: string; // ISO UTC
  eventTimeSource: EventTimeSource;
  taggerVersion: string;
}
