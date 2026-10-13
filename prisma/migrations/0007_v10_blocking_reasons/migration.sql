-- V10: explicit blocking / decision trace on every review item
ALTER TABLE "review_queue" ADD COLUMN "final_decision_reason" TEXT;
ALTER TABLE "review_queue" ADD COLUMN "next_action_at" TIMESTAMP(3);
ALTER TABLE "review_queue" ADD COLUMN "blocking_factors" TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS "review_queue_next_action_at_idx" ON "review_queue" ("next_action_at");
CREATE INDEX IF NOT EXISTS "review_queue_final_decision_reason_idx" ON "review_queue" ("final_decision_reason");
