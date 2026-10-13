/**
 * PolicyOS Pipeline Framework.
 *
 * A pipeline is a source-to-policy transformation. It runs in nine discrete,
 * inspectable stages:
 *
 *   1. fetch          — pull raw bytes from a monitored source
 *   2. normalize      — strip noise so hashes compare meaningfully
 *   3. hash           — sha256 of normalized content
 *   4. compareHash    — was this content seen before?
 *   5. parse          — extract structured signal (title, links, dates…)
 *   6. classifyChange — new_policy / amendment / repeal / proposal_only / …
 *   7. matchPolicy    — which existing policy (if any) does this update?
 *   8. persist        — write snapshot, version, audit
 *   9. recomputeScore — trigger score recalculation if meaning changed
 *
 * Each concrete pipeline supplies `fetch`, `normalize`, `parse`,
 * `classifyChange`, and `matchPolicy`. The framework runs the rest.
 *
 * The framework is database-aware: all writes go through `src/lib/db`.
 */

import type {
  ChangeClassification,
  LifecycleStatus,
  VerificationConfidence,
} from '@prisma/client';

export interface FetchResult {
  ok: boolean;
  status: number; // HTTP status or -1 for network error
  text: string;
  fetchedAt: Date;
  error?: string;
}

export interface ParsedSignal {
  /** Best-effort human-readable title extracted from the source. */
  title?: string;
  /** Short plain-text summary for display. Should be <300 chars. */
  summary?: string;
  /** Longer extracted text kept for diffing / later AI analysis. */
  extractedText?: string;
  /** Link count or similar structural fingerprint, for minor-change heuristics. */
  linkCount?: number;
  /** Optional ISO date strings parsed from the source. */
  announcedDate?: string;
  effectiveDate?: string;
  expiryDate?: string;
  /** V4 extraction provenance: how this signal was produced. */
  extractionMethod?: 'deterministic' | 'heuristic' | 'ai_assisted' | 'mixed';
  /** V4: what kind of content is this? Operational guidance vs legal vs proposal vs news. */
  guidanceType?: 'operational_guidance' | 'legal_announcement' | 'proposal' | 'news' | 'index';
  /** V4: list of hinted impacted submetrics (empty unless the extractor has high-signal content). */
  hintedSubmetrics?: string[];
  /** V4: hinted impact direction, if the content contains obviously restrictive or loosening language. */
  hintedDirection?: 'positive' | 'negative' | 'mixed' | 'neutral';
  /** Arbitrary key/value metadata stored on the snapshot for debugging. */
  metadata?: Record<string, unknown>;
}

export interface ClassifyInput {
  previousHash: string | null;
  currentHash: string;
  previousSignal: ParsedSignal | null;
  currentSignal: ParsedSignal;
  previousText?: string | null;
  currentText: string;
}

export interface ClassifyResult {
  classification: ChangeClassification;
  confidence: VerificationConfidence;
  suggestedStatus?: LifecycleStatus;
  summary: string;
}

export interface MatchedPolicy {
  /** Existing policy id we should attach a version to, if any. */
  policyId?: string;
  /** If we should *create* a new policy, these are the seed fields. */
  createPolicy?: {
    slug: string;
    title: string;
    summary?: string;
  };
}

/**
 * Minimal info the framework needs about the monitored source before a run.
 * We accept a plain object rather than the full Prisma row so tests can
 * supply fakes without needing a DB.
 */
export interface SourceContext {
  id: string;
  countryIso: string;
  pipelineKey: string;
  sourceUrl: string;
  sourceName: string;
  domain: 'climate' | 'trade' | 'immigration';
  lastHash: string | null;
}

export interface DeepItem {
  /** External URL for the item (used by matcher's exact_url path). */
  url: string;
  /** Best-effort title of the individual item. */
  title: string;
  /** Short summary of the item (typically 1–3 sentences). */
  summary?: string;
  /** Effective date if detectable from the item's context. */
  effectiveDate?: string;
  /** law | regulation | guidance | proposal — V5 structured field. */
  policyType?: 'law' | 'regulation' | 'guidance' | 'proposal';
  /** Content-typing hint passed through to PolicyVersion.guidanceType. */
  guidanceType?: 'operational_guidance' | 'legal_announcement' | 'proposal' | 'news' | 'index';
  /** Parsed numeric values (tariff %, quota, threshold). Stored on PolicyVersion.numericValues. */
  numericValues?: Record<string, number | string>;
  /** Plain-text snippet used for keyword → submetric mapping. */
  extractedText?: string;
}

export interface PipelineDefinition {
  key: string; // matches MonitoredSource.pipelineKey
  label: string; // human-readable, shown in /admin

  fetch(ctx: SourceContext): Promise<FetchResult>;
  normalize(raw: string): string;
  parse(normalized: string): ParsedSignal;
  classifyChange(input: ClassifyInput): ClassifyResult;
  matchPolicy(ctx: SourceContext, signal: ParsedSignal): Promise<MatchedPolicy>;

  /**
   * V5 optional deep-extraction hook.
   *
   * Pipelines that can extract multiple discrete items from a single source
   * page (e.g. USCIS policy manual updates) return them here. The runner
   * iterates items and creates one Policy + PolicyVersion per item. Pipelines
   * that don't need this leave the hook undefined.
   */
  deepItems?(ctx: SourceContext, signal: ParsedSignal, normalized: string): Promise<DeepItem[]>;
}

export interface RunOutcome {
  runId: string;
  sourceId: string;
  pipelineKey: string;
  status: 'success' | 'partial' | 'failed';
  hash: string | null;
  previousHash: string | null;
  changeDetected: boolean;
  classification: ChangeClassification | null;
  summary: string;
  policyId?: string | null;
  versionId?: string | null;
  reviewItemId?: string | null;
  scoreChangeLogId?: string | null;
  error?: string;
}

// ─── sha256 helper ─────────────────────────────────────────────────────────
// Kept in this module to avoid drag of Node's crypto into edge runtimes
// that don't need pipeline execution.

import { createHash } from 'node:crypto';

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
