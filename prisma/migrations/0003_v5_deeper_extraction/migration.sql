-- V5: structured extraction fields on PolicyVersion
ALTER TABLE "policy_versions"
  ADD COLUMN "policy_type" TEXT,
  ADD COLUMN "numeric_values" JSONB,
  ADD COLUMN "mapping_rules" TEXT[] DEFAULT '{}';
