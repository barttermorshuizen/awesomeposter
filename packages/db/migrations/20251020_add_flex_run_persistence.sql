BEGIN;

CREATE TABLE IF NOT EXISTS flex_plan_snapshots (
    run_id TEXT NOT NULL REFERENCES flex_runs(run_id) ON DELETE CASCADE,
    plan_version INTEGER NOT NULL,
    snapshot_json JSONB NOT NULL,
    facet_snapshot_json JSONB,
    schema_hash TEXT,
    pending_node_ids TEXT[] NOT NULL DEFAULT '{}'::text[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (run_id, plan_version)
);

CREATE TABLE IF NOT EXISTS flex_run_outputs (
    run_id TEXT PRIMARY KEY REFERENCES flex_runs(run_id) ON DELETE CASCADE,
    plan_version INTEGER NOT NULL,
    schema_hash TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    output_json JSONB NOT NULL,
    facet_snapshot_json JSONB,
    provenance_json JSONB,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMIT;

---- migrate:down

BEGIN;
DROP TABLE IF EXISTS flex_run_outputs;
DROP TABLE IF EXISTS flex_plan_snapshots;
COMMIT;
