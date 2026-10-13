
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Domain" AS ENUM ('climate', 'trade', 'immigration');

-- CreateEnum
CREATE TYPE "LifecycleStatus" AS ENUM ('active', 'pending', 'amended', 'suspended', 'expired', 'repealed', 'superseded', 'unknown');

-- CreateEnum
CREATE TYPE "VerificationConfidence" AS ENUM ('high', 'medium', 'low', 'unverified');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('official_source', 'trusted_secondary', 'ai_inferred', 'user_submitted', 'seeded_data');

-- CreateEnum
CREATE TYPE "SourceType" AS ENUM ('government', 'legislature', 'ministry', 'court', 'multilateral', 'media', 'think_tank', 'community_submission');

-- CreateEnum
CREATE TYPE "ChangeClassification" AS ENUM ('new_policy', 'amendment', 'repeal', 'suspension', 'expiry', 'proposal_only', 'no_material_change', 'uncertain');

-- CreateEnum
CREATE TYPE "PipelineRunStatus" AS ENUM ('success', 'partial', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected', 'merged', 'proposal_only');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('submitted', 'under_review', 'accepted', 'rejected', 'merged');

-- CreateEnum
CREATE TYPE "ImpactDirection" AS ENUM ('positive', 'negative', 'mixed', 'neutral');

-- CreateTable
CREATE TABLE "countries" (
    "id" SERIAL NOT NULL,
    "iso2" VARCHAR(2) NOT NULL,
    "iso3" VARCHAR(3) NOT NULL,
    "name" TEXT NOT NULL,
    "region" TEXT,
    "population" BIGINT,
    "gdp_millions_usd" BIGINT,
    "government_type" TEXT,
    "head_of_state" TEXT,
    "flag_emoji" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "countries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policies" (
    "id" TEXT NOT NULL,
    "country_id" INTEGER NOT NULL,
    "domain" "Domain" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "summary" TEXT,
    "status" "LifecycleStatus" NOT NULL DEFAULT 'unknown',
    "announced_date" DATE,
    "effective_date" DATE,
    "expiry_date" DATE,
    "last_verified_at" TIMESTAMP(3),
    "next_review_at" TIMESTAMP(3),
    "verification_confidence" "VerificationConfidence" NOT NULL DEFAULT 'unverified',
    "verification_method" "VerificationMethod" NOT NULL DEFAULT 'seeded_data',
    "source_type" "SourceType" NOT NULL DEFAULT 'government',
    "official_source_url" TEXT,
    "source_name" TEXT,
    "source_available" BOOLEAN NOT NULL DEFAULT true,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "superseded_by_policy_id" TEXT,
    "replaces_policy_id" TEXT,
    "current_version_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_versions" (
    "id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "change_type" "ChangeClassification" NOT NULL,
    "summary" TEXT,
    "extracted_text" TEXT,
    "source_url" TEXT,
    "source_hash" VARCHAR(64),
    "confidence" "VerificationConfidence" NOT NULL DEFAULT 'unverified',
    "approved_state" "LifecycleStatus",
    "impact_direction" "ImpactDirection" NOT NULL DEFAULT 'neutral',
    "impact_magnitude" INTEGER NOT NULL DEFAULT 0,
    "affected_submetrics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "score_explanation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "monitored_sources" (
    "id" TEXT NOT NULL,
    "country_id" INTEGER NOT NULL,
    "domain" "Domain" NOT NULL,
    "source_name" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "source_type" "SourceType" NOT NULL,
    "trust_priority" INTEGER NOT NULL DEFAULT 3,
    "scrape_method" TEXT NOT NULL DEFAULT 'fetch_html',
    "parser_key" TEXT,
    "pipeline_key" TEXT,
    "check_frequency_hours" INTEGER NOT NULL DEFAULT 24,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_checked_at" TIMESTAMP(3),
    "last_success_at" TIMESTAMP(3),
    "last_hash" VARCHAR(64),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monitored_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_snapshots" (
    "id" TEXT NOT NULL,
    "monitored_source_id" TEXT NOT NULL,
    "content_hash" VARCHAR(64) NOT NULL,
    "snapshot_text" TEXT,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fetch_status" INTEGER NOT NULL,
    "byte_size" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "source_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_scores" (
    "id" TEXT NOT NULL,
    "country_id" INTEGER NOT NULL,
    "domain" "Domain" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "methodology_version" TEXT NOT NULL DEFAULT '1.0',
    "last_computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "explanation" TEXT,

    CONSTRAINT "domain_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_submetrics" (
    "id" TEXT NOT NULL,
    "country_id" INTEGER NOT NULL,
    "domain" "Domain" NOT NULL,
    "key" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT,
    "last_computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_submetrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "score_change_logs" (
    "id" TEXT NOT NULL,
    "country_id" INTEGER NOT NULL,
    "domain" "Domain" NOT NULL,
    "previous_score" DOUBLE PRECISION NOT NULL,
    "new_score" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "triggering_policy_id" TEXT,
    "triggering_version_id" TEXT,
    "explanation" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_change_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "contribution_type" TEXT NOT NULL,
    "country_id" INTEGER,
    "domain" "Domain",
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "source_url" TEXT,
    "submitter_name" TEXT,
    "submitter_email" TEXT,
    "status" "ContributionStatus" NOT NULL DEFAULT 'submitted',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_queue" (
    "id" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "contribution_id" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 3,
    "confidence" "VerificationConfidence" NOT NULL DEFAULT 'unverified',
    "recommended_action" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_queue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_actions" (
    "id" TEXT NOT NULL,
    "review_queue_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reviewer" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "action_type" TEXT NOT NULL,
    "previous_value_json" JSONB,
    "new_value_json" JSONB,
    "source_url" TEXT,
    "actor_type" TEXT,
    "actor_id" TEXT,
    "confidence" "VerificationConfidence" NOT NULL DEFAULT 'unverified',
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_runs" (
    "id" TEXT NOT NULL,
    "pipeline_key" TEXT NOT NULL,
    "monitored_source_id" TEXT,
    "status" "PipelineRunStatus" NOT NULL,
    "change_detected" BOOLEAN NOT NULL DEFAULT false,
    "change_type" "ChangeClassification",
    "summary" TEXT,
    "error_message" TEXT,
    "items_processed" INTEGER NOT NULL DEFAULT 0,
    "items_changed" INTEGER NOT NULL DEFAULT 0,
    "items_flagged" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "pipeline_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_articles" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "source" TEXT NOT NULL,
    "url" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL,
    "domain" "Domain" NOT NULL,
    "ingestion_type" TEXT NOT NULL DEFAULT 'curated',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "policy_news_links" (
    "id" TEXT NOT NULL,
    "news_article_id" TEXT NOT NULL,
    "policy_id" TEXT,
    "country_iso" VARCHAR(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "policy_news_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "countries_iso2_key" ON "countries"("iso2");

-- CreateIndex
CREATE UNIQUE INDEX "countries_iso3_key" ON "countries"("iso3");

-- CreateIndex
CREATE INDEX "countries_region_idx" ON "countries"("region");

-- CreateIndex
CREATE UNIQUE INDEX "policies_current_version_id_key" ON "policies"("current_version_id");

-- CreateIndex
CREATE INDEX "policies_country_id_domain_status_idx" ON "policies"("country_id", "domain", "status");

-- CreateIndex
CREATE INDEX "policies_domain_status_idx" ON "policies"("domain", "status");

-- CreateIndex
CREATE INDEX "policies_next_review_at_idx" ON "policies"("next_review_at");

-- CreateIndex
CREATE UNIQUE INDEX "policies_country_id_slug_key" ON "policies"("country_id", "slug");

-- CreateIndex
CREATE INDEX "policy_versions_policy_id_created_at_idx" ON "policy_versions"("policy_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "policy_versions_policy_id_version_number_key" ON "policy_versions"("policy_id", "version_number");

-- CreateIndex
CREATE INDEX "monitored_sources_country_id_domain_active_idx" ON "monitored_sources"("country_id", "domain", "active");

-- CreateIndex
CREATE INDEX "monitored_sources_active_last_checked_at_idx" ON "monitored_sources"("active", "last_checked_at");

-- CreateIndex
CREATE INDEX "source_snapshots_monitored_source_id_fetched_at_idx" ON "source_snapshots"("monitored_source_id", "fetched_at");

-- CreateIndex
CREATE UNIQUE INDEX "domain_scores_country_id_domain_key" ON "domain_scores"("country_id", "domain");

-- CreateIndex
CREATE INDEX "score_submetrics_country_id_domain_idx" ON "score_submetrics"("country_id", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "score_submetrics_country_id_domain_key_key" ON "score_submetrics"("country_id", "domain", "key");

-- CreateIndex
CREATE INDEX "score_change_logs_country_id_domain_created_at_idx" ON "score_change_logs"("country_id", "domain", "created_at");

-- CreateIndex
CREATE INDEX "contributions_status_created_at_idx" ON "contributions"("status", "created_at");

-- CreateIndex
CREATE INDEX "review_queue_status_priority_created_at_idx" ON "review_queue"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "review_queue_target_type_target_id_idx" ON "review_queue"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "review_actions_review_queue_id_created_at_idx" ON "review_actions"("review_queue_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_created_at_idx" ON "audit_logs"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_type_created_at_idx" ON "audit_logs"("actor_type", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");

-- CreateIndex
CREATE INDEX "pipeline_runs_pipeline_key_started_at_idx" ON "pipeline_runs"("pipeline_key", "started_at");

-- CreateIndex
CREATE INDEX "pipeline_runs_status_started_at_idx" ON "pipeline_runs"("status", "started_at");

-- CreateIndex
CREATE INDEX "news_articles_published_at_idx" ON "news_articles"("published_at");

-- CreateIndex
CREATE INDEX "news_articles_domain_published_at_idx" ON "news_articles"("domain", "published_at");

-- CreateIndex
CREATE INDEX "policy_news_links_policy_id_idx" ON "policy_news_links"("policy_id");

-- CreateIndex
CREATE INDEX "policy_news_links_country_iso_idx" ON "policy_news_links"("country_iso");

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_current_version_id_fkey" FOREIGN KEY ("current_version_id") REFERENCES "policy_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policies" ADD CONSTRAINT "policies_superseded_by_policy_id_fkey" FOREIGN KEY ("superseded_by_policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_versions" ADD CONSTRAINT "policy_versions_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "monitored_sources" ADD CONSTRAINT "monitored_sources_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_snapshots" ADD CONSTRAINT "source_snapshots_monitored_source_id_fkey" FOREIGN KEY ("monitored_source_id") REFERENCES "monitored_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "domain_scores" ADD CONSTRAINT "domain_scores_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_submetrics" ADD CONSTRAINT "score_submetrics_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_change_logs" ADD CONSTRAINT "score_change_logs_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "score_change_logs" ADD CONSTRAINT "score_change_logs_triggering_policy_id_fkey" FOREIGN KEY ("triggering_policy_id") REFERENCES "policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_country_id_fkey" FOREIGN KEY ("country_id") REFERENCES "countries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_queue" ADD CONSTRAINT "review_queue_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_actions" ADD CONSTRAINT "review_actions_review_queue_id_fkey" FOREIGN KEY ("review_queue_id") REFERENCES "review_queue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_runs" ADD CONSTRAINT "pipeline_runs_monitored_source_id_fkey" FOREIGN KEY ("monitored_source_id") REFERENCES "monitored_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "policy_news_links" ADD CONSTRAINT "policy_news_links_news_article_id_fkey" FOREIGN KEY ("news_article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
