CREATE TABLE IF NOT EXISTS flex_runs (
    run_id TEXT PRIMARY KEY,
    thread_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    objective TEXT,
    envelope_json JSONB NOT NULL,
    schema_hash TEXT,
    metadata_json JSONB DEFAULT '{}'::jsonb,
    result_json JSONB,
    plan_version INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS flex_plan_nodes (
    run_id TEXT NOT NULL REFERENCES flex_runs(run_id) ON DELETE CASCADE,
    node_id TEXT NOT NULL,
    capability_id TEXT,
    label TEXT,
    status TEXT DEFAULT 'pending',
    context_json JSONB DEFAULT '{}'::jsonb,
    output_json JSONB,
    error_json JSONB,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (run_id, node_id)
);

CREATE INDEX IF NOT EXISTS flex_plan_nodes_status_idx ON flex_plan_nodes (status);

---- migrate:down

DROP INDEX IF EXISTS flex_plan_nodes_status_idx;
DROP TABLE IF EXISTS flex_plan_nodes;
DROP TABLE IF EXISTS flex_runs;
