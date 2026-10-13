-- AlterEnum
ALTER TYPE "ChangeClassification" ADD VALUE 'guidance_update';

-- AlterTable
ALTER TABLE "news_articles" ADD COLUMN     "feed_guid" TEXT,
ADD COLUMN     "feed_key" TEXT,
ADD COLUMN     "provenance" TEXT;

-- AlterTable
ALTER TABLE "policy_versions" ADD COLUMN     "extraction_confidence" "VerificationConfidence",
ADD COLUMN     "extraction_method" TEXT,
ADD COLUMN     "guidance_type" TEXT;

-- AlterTable
ALTER TABLE "score_submetrics" ADD COLUMN     "evidence_backed_at" TIMESTAMP(3),
ADD COLUMN     "evidence_policy_version_id" TEXT;

-- CreateIndex
CREATE INDEX "news_articles_ingestion_type_published_at_idx" ON "news_articles"("ingestion_type", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_feed_key_feed_guid_key" ON "news_articles"("feed_key", "feed_guid");

