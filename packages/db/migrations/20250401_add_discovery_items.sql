-- Adds discovery_items table and metrics_json column for ingestion telemetry

ALTER TABLE discovery_ingest_runs
ADD COLUMN IF NOT EXISTS metrics_json jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS discovery_items (
  id uuid PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  source_id uuid NOT NULL REFERENCES discovery_sources(id) ON DELETE CASCADE,
  external_id text NOT NULL,
  raw_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending_scoring',
  title text NOT NULL,
  url text NOT NULL,
  fetched_at timestamptz NOT NULL,
  published_at timestamptz,
  published_at_source text NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  raw_payload_json jsonb NOT NULL,
  normalized_json jsonb NOT NULL,
  source_metadata_json jsonb NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS discovery_items_client_hash_unique
  ON discovery_items (client_id, raw_hash);

CREATE INDEX IF NOT EXISTS discovery_items_status_idx
  ON discovery_items (status);

CREATE INDEX IF NOT EXISTS discovery_items_source_idx
  ON discovery_items (source_id);
