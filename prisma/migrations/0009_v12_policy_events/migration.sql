-- V12: market-linkable policy events (hand-written in Prisma's output style;
-- verify with `npx prisma migrate diff` on a machine with engines available).

-- CreateTable
CREATE TABLE "policy_events" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "agency" TEXT NOT NULL,
    "doc_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "action" TEXT,
    "abstract" TEXT,
    "html_url" TEXT NOT NULL,
    "publication_date" DATE NOT NULL,
    "public_inspection_at" TIMESTAMP(3),
    "event_instant" TIMESTAMP(3) NOT NULL,
    "event_time_source" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "china_related" BOOLEAN NOT NULL,
    "semis_related" BOOLEAN NOT NULL,
    "direction" TEXT NOT NULL,
    "relevant" BOOLEAN NOT NULL,
    "tagger_version" TEXT NOT NULL,
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "review_note" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policy_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "policy_events_source_external_id_key" ON "policy_events"("source", "external_id");

-- CreateIndex
CREATE INDEX "policy_events_relevant_event_instant_idx" ON "policy_events"("relevant", "event_instant");

-- CreateIndex
CREATE INDEX "policy_events_event_type_event_instant_idx" ON "policy_events"("event_type", "event_instant");
