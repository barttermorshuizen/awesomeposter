BEGIN;

ALTER TABLE flex_runs
ADD COLUMN IF NOT EXISTS context_snapshot_json jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMIT;
