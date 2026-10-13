-- Additive: historical review items remain unlinked; never reconstruct their
-- missing source passages from today's web pages.
CREATE TABLE "verification_runs" (
    "id" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "verification_runs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "review_queue" ADD COLUMN "verification_run_id" TEXT;
CREATE INDEX "review_queue_verification_run_id_idx" ON "review_queue"("verification_run_id");
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_verification_run_id_fkey"
    FOREIGN KEY ("verification_run_id") REFERENCES "verification_runs"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
