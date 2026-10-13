-- V11: self-healing pipeline + auto-switch primary + PDF counter + resolution trace + priority score

-- MonitoredSource: self-healing + auto-switch
ALTER TABLE "monitored_sources" ADD COLUMN "base_frequency_hours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "monitored_sources" ADD COLUMN "consecutive_fails" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "monitored_sources" ADD COLUMN "consecutive_successes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "monitored_sources" ADD COLUMN "original_primary_url" TEXT;
ALTER TABLE "monitored_sources" ADD COLUMN "switched_to_fallback" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "monitored_sources" ADD COLUMN "pdfs_processed" INTEGER NOT NULL DEFAULT 0;

-- Seed base_frequency_hours from current check_frequency_hours.
UPDATE "monitored_sources" SET "base_frequency_hours" = "check_frequency_hours";

-- ReviewQueueItem: explainability + priority
ALTER TABLE "review_queue" ADD COLUMN "resolution_trace" JSONB;
ALTER TABLE "review_queue" ADD COLUMN "priority_score" DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE "review_queue" ADD COLUMN "multi_source_confidence" DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS "review_queue_priority_score_idx" ON "review_queue" ("priority_score" DESC);
