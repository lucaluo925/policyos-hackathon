-- V9: auto-resolution engine for the review queue

-- Extend ReviewStatus with auto-resolution outcomes.
ALTER TYPE "ReviewStatus" ADD VALUE IF NOT EXISTS 'auto_approved';
ALTER TYPE "ReviewStatus" ADD VALUE IF NOT EXISTS 'escalated';
ALTER TYPE "ReviewStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TYPE "ReviewStatus" ADD VALUE IF NOT EXISTS 'conflict';

-- Resolution trace + duplicate-collapsing fields on ReviewQueueItem.
ALTER TABLE "review_queue" ADD COLUMN "auto_resolution" TEXT;
ALTER TABLE "review_queue" ADD COLUMN "resolved_at" TIMESTAMP(3);
ALTER TABLE "review_queue" ADD COLUMN "group_key" TEXT;
ALTER TABLE "review_queue" ADD COLUMN "occurrence_count" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "review_queue" ADD COLUMN "merged_into_id" TEXT;

CREATE INDEX IF NOT EXISTS "review_queue_group_key_idx" ON "review_queue" ("group_key");
CREATE INDEX IF NOT EXISTS "review_queue_status_resolved_at_idx" ON "review_queue" ("status", "resolved_at");
