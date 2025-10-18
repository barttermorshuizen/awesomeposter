CREATE TABLE IF NOT EXISTS discovery_bulk_action_audits (
  id UUID PRIMARY KEY,
  action_id UUID NOT NULL UNIQUE,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  filters_snapshot JSONB,
  item_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  success_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  conflict_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  failed_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  success_brief_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  results_json JSONB NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  total_count INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS discovery_bulk_action_audits_client_idx
  ON discovery_bulk_action_audits (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS discovery_bulk_action_audits_action_idx
  ON discovery_bulk_action_audits (action, created_at DESC);
