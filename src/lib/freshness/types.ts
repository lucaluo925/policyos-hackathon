import type { CategoryKey } from '@/lib/data/metrics';

// Policy lifecycle statuses
export type PolicyStatus = 'active' | 'pending' | 'amended' | 'suspended' | 'expired' | 'repealed' | 'superseded' | 'unknown';

// Verification confidence levels
export type VerificationConfidence = 'high' | 'medium' | 'low' | 'unverified';

// Verification methods
export type VerificationMethod = 'official_source' | 'trusted_secondary_source' | 'ai_inferred' | 'user_submitted_unverified' | 'seeded_data';

// Source types
export type SourceType = 'government' | 'legislature' | 'ministry' | 'court' | 'multilateral' | 'reputable_media' | 'think_tank' | 'community_submission';

// Check frequency
export type CheckFrequency = 'high' | 'medium' | 'low'; // high=daily, medium=3-day, low=weekly

// Policy lifecycle metadata - extends the base Policy
export interface PolicyLifecycle {
  policyId: string;
  status: PolicyStatus;
  effectiveDate: string;          // ISO date
  announcedDate?: string;         // when first announced/proposed
  lastVerifiedAt: string;         // ISO datetime
  nextReviewAt: string;           // ISO datetime
  expiryDate?: string;            // if policy has sunset clause
  supersededByPolicyId?: string;  // newer policy that replaces this
  replacesPolicyId?: string;      // older policy this replaced
  verificationConfidence: VerificationConfidence;
  verificationMethod: VerificationMethod;
  sourceType: SourceType;
  officialSourceUrl?: string;
  lastSourceHash?: string;        // hash of source content at last check
  lastSourceCheckAt?: string;     // when source was last fetched
  sourceAvailable: boolean;       // whether source URL still resolves
  notes?: string;                 // human-readable notes about status
}

// Policy version - tracks changes over time
export interface PolicyVersion {
  id: string;
  policyId: string;
  versionNumber: number;
  changeType: 'created' | 'amended' | 'suspended' | 'repealed' | 'superseded' | 'status_change' | 'correction' | 'verified';
  previousStatus?: PolicyStatus;
  newStatus: PolicyStatus;
  summary: string;                // what changed
  diff?: string;                  // text diff if applicable
  sourceUrl?: string;
  sourceEvidence?: string;
  confidence: VerificationConfidence;
  createdAt: string;              // ISO datetime
  createdBy: string;              // 'system' | 'cron:freshness' | 'cron:news' | 'admin:xxx' | 'user:xxx'
  reviewedBy?: string;
  reviewedAt?: string;
}

// Monitored source - official sources to check for each country-domain pair
export interface MonitoredSource {
  id: string;
  countryIso: string;
  category: CategoryKey;
  name: string;
  url: string;
  sourceType: SourceType;
  checkFrequency: CheckFrequency;
  trustPriority: number;          // 1=highest trust, 5=lowest
  lastCheckedAt?: string;
  lastContentHash?: string;
  lastChangeDetectedAt?: string;
  isActive: boolean;
  scrapeMethod: 'html_fetch' | 'rss' | 'api' | 'manual';
  notes?: string;
}

// Audit log entry
export interface AuditLogEntry {
  id: string;
  timestamp: string;              // ISO datetime
  action: 'policy_created' | 'policy_updated' | 'policy_status_changed' | 'score_recomputed' | 'source_checked' | 'source_changed' | 'review_approved' | 'review_rejected' | 'news_ingested' | 'stale_detected' | 'auto_verified';
  entityType: 'policy' | 'source' | 'score' | 'news';
  entityId: string;
  previousValue?: string;         // JSON string of old state
  newValue?: string;              // JSON string of new state
  reason: string;
  sourceUrl?: string;
  confidence?: VerificationConfidence;
  performedBy: string;            // 'system' | 'cron:xxx' | 'admin:xxx' | 'user:xxx'
  modelOrParser?: string;         // if AI was involved
}

// Review queue item
export interface ReviewQueueItem {
  id: string;
  createdAt: string;
  type: 'new_policy' | 'policy_update' | 'status_change' | 'stale_flag' | 'user_submission' | 'source_conflict';
  policyId?: string;
  countryIso: string;
  category: CategoryKey;
  title: string;
  description: string;
  sourceUrl?: string;
  sourceEvidence?: string;
  suggestedStatus?: PolicyStatus;
  confidence: VerificationConfidence;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'approved' | 'rejected' | 'merged';
  reviewerNotes?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  autoResolvable: boolean;        // can be auto-approved if confidence is high enough
  submittedBy: string;            // 'cron:freshness' | 'cron:news' | 'user:xxx'
}

// Score change record
export interface ScoreChangeRecord {
  id: string;
  countryIso: string;
  category: CategoryKey;
  previousScore: number;
  newScore: number;
  delta: number;
  reason: string;                 // e.g., "Policy us-c1 status changed from active to repealed"
  triggeredByPolicyId?: string;
  computedAt: string;
  computedBy: string;             // 'cron:scores' | 'admin:xxx'
}

// Freshness summary for a country
export interface CountryFreshnessSummary {
  iso: string;
  totalPolicies: number;
  activePolicies: number;
  stalePolicies: number;          // not verified in >30 days
  recentlyVerified: number;       // verified in last 7 days
  pendingReview: number;
  lastFullVerification: string;
  overallConfidence: VerificationConfidence;
  nextScheduledCheck: string;
}

// Pipeline run status
export interface PipelineRun {
  id: string;
  pipelineType: 'source_freshness' | 'news_ingestion' | 'stale_review' | 'score_recomputation' | 'deep_verification';
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'completed' | 'failed';
  itemsProcessed: number;
  itemsChanged: number;
  itemsFlagged: number;
  errors: string[];
  triggeredBy: string;            // 'cron' | 'manual' | 'webhook'
}
