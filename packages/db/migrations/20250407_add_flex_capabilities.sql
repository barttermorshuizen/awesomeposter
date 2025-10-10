CREATE TABLE IF NOT EXISTS flex_capabilities (
    capability_id TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    display_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    input_traits_json JSONB DEFAULT NULL,
    default_contract_json JSONB DEFAULT NULL,
    cost_json JSONB DEFAULT NULL,
    preferred_models TEXT[] DEFAULT ARRAY[]::TEXT[],
    heartbeat_json JSONB DEFAULT NULL,
    metadata_json JSONB DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    last_seen_at TIMESTAMPTZ,
    registered_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS flex_capabilities_status_idx ON flex_capabilities (status);
CREATE INDEX IF NOT EXISTS flex_capabilities_last_seen_idx ON flex_capabilities (last_seen_at);
