BEGIN;

ALTER TABLE flex_plan_nodes
  ADD COLUMN IF NOT EXISTS post_condition_guards_json JSONB,
  ADD COLUMN IF NOT EXISTS post_condition_results_json JSONB;

ALTER TABLE flex_run_outputs
  ADD COLUMN IF NOT EXISTS post_condition_results_json JSONB;

COMMIT;

---- migrate:down

BEGIN;

ALTER TABLE flex_plan_nodes
  DROP COLUMN IF EXISTS post_condition_guards_json,
  DROP COLUMN IF EXISTS post_condition_results_json;

ALTER TABLE flex_run_outputs
  DROP COLUMN IF EXISTS post_condition_results_json;

COMMIT;
