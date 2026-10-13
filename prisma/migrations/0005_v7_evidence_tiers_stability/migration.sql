-- V7: evidence tiers + source stability tracking + graceful-degradation status

-- PolicyVersion: evidence tier
ALTER TABLE "policy_versions" ADD COLUMN "evidence_type" TEXT;

-- ScoreSubmetric: continuous evidence tracking
ALTER TABLE "score_submetrics" ADD COLUMN "evidence_count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "score_submetrics" ADD COLUMN "last_evidence_at" TIMESTAMP(3);

-- MonitoredSource: stability + fallback
ALTER TABLE "monitored_sources" ADD COLUMN "failure_rate" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "monitored_sources" ADD COLUMN "is_stable" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "monitored_sources" ADD COLUMN "fallback_urls" TEXT[] DEFAULT '{}';

-- Add partial_success to PipelineRunStatus enum
ALTER TYPE "PipelineRunStatus" ADD VALUE 'partial_success';
