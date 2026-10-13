-- V6: pipeline reliability + deep-extraction counters
ALTER TABLE "pipeline_runs"
  ADD COLUMN "failure_type" TEXT,
  ADD COLUMN "retry_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deep_items_fetched" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "deep_items_applied" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS "pipeline_runs_failure_type_idx"
  ON "pipeline_runs" ("failure_type");
