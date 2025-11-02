CREATE TABLE IF NOT EXISTS flex_assets (
  id uuid PRIMARY KEY,
  assignment_id text NOT NULL,
  run_id text,
  node_id text,
  facet text NOT NULL,
  url text NOT NULL,
  filename text NOT NULL,
  original_name text,
  mime_type text,
  file_size integer,
  ordering integer DEFAULT 0,
  meta_json jsonb DEFAULT '{}'::jsonb,
  uploaded_by text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS flex_assets_assignment_idx ON flex_assets (assignment_id);
CREATE INDEX IF NOT EXISTS flex_assets_run_idx ON flex_assets (run_id);
