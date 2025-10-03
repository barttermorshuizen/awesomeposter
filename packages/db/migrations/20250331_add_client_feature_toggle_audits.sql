CREATE TABLE IF NOT EXISTS client_feature_toggle_audits (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  feature text NOT NULL,
  previous_enabled boolean NOT NULL,
  new_enabled boolean NOT NULL,
  actor text NOT NULL,
  reason text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_feature_toggle_audits_client_id_idx
  ON client_feature_toggle_audits (client_id);

CREATE INDEX IF NOT EXISTS client_feature_toggle_audits_created_at_idx
  ON client_feature_toggle_audits (created_at DESC);