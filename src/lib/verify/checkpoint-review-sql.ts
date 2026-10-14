import type { CostCheckpoint } from './cost-checkpoint';

/** A review artifact only. No database connection or execution in this module. */
export function checkpointReviewSql(campaign: string, checkpoint: CostCheckpoint): string {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(campaign) || !/^[a-f0-9]{64}$/.test(checkpoint.anchorHash) ||
      !Number.isSafeInteger(checkpoint.capMicroUsd) || checkpoint.capMicroUsd < 1) throw new Error('Invalid review packet');
  const quoted = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const where = `entity_type='verification_model_budget' AND entity_id=${quoted(campaign)}`;
  const calls = `${where} AND action_type='model_call_reserved'`;
  return `-- REVIEW ONLY: one new checkpoint, never an update/delete of call rows.
-- Run only after explicit operator approval and reconciliation of the statement.
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
DO $checkpoint$
DECLARE current_hash text;
BEGIN
  IF EXISTS (SELECT 1 FROM audit_logs WHERE ${where} AND action_type='model_cost_checkpoint') THEN
    RAISE EXCEPTION 'A checkpoint already exists; no replacement is permitted';
  END IF;
  IF EXISTS (SELECT 1 FROM audit_logs WHERE ${calls} AND
    (COALESCE(new_value_json->>'state','') <> 'settled'
     OR COALESCE(jsonb_typeof(new_value_json->'microUsd'),'') <> 'number'
     OR (new_value_json->>'microUsd')::numeric <> trunc((new_value_json->>'microUsd')::numeric)
     OR (new_value_json->>'microUsd')::numeric < 0
     OR COALESCE(jsonb_typeof(new_value_json->'capMicroUsd'),'') <> 'number'
     OR (new_value_json->>'capMicroUsd')::numeric <> ${checkpoint.capMicroUsd})) THEN
    RAISE EXCEPTION 'Existing ledger is not a valid settled anchor';
  END IF;
  SELECT encode(sha256(convert_to(string_agg(id || ':' ||
    (new_value_json->>'microUsd')::numeric::bigint::text || ':' ||
    (new_value_json->>'state') || ':' ||
    (new_value_json->>'capMicroUsd')::numeric::bigint::text || ':' ||
    floor(extract(epoch FROM created_at)*1000)::bigint::text,
    chr(10) ORDER BY id COLLATE "C"), 'UTF8')), 'hex') INTO current_hash
    FROM audit_logs WHERE ${calls};
  IF current_hash IS DISTINCT FROM ${quoted(checkpoint.anchorHash)} THEN
    RAISE EXCEPTION 'Call ledger changed after preview; regenerate the packet';
  END IF;
  IF CURRENT_TIMESTAMP < ${quoted(checkpoint.providerAsOf)}::timestamptz THEN
    RAISE EXCEPTION 'Provider observation is in the future';
  END IF;
  INSERT INTO audit_logs (id,entity_type,entity_id,action_type,new_value_json,actor_type,summary)
    VALUES ('cost-checkpoint-' || gen_random_uuid()::text,'verification_model_budget',
      ${quoted(campaign)},'model_cost_checkpoint',${quoted(JSON.stringify(checkpoint))}::jsonb,
      'admin','Operator-reviewed historical cost checkpoint; existing model rows preserved');
END;
$checkpoint$;
COMMIT;
`;
}
