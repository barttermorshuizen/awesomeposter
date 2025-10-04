ALTER TABLE "discovery_sources"
  ADD COLUMN IF NOT EXISTS "fetch_interval_minutes" integer NOT NULL DEFAULT 60,
  ADD COLUMN IF NOT EXISTS "next_fetch_at" timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS "last_fetch_started_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_fetch_completed_at" timestamptz,
  ADD COLUMN IF NOT EXISTS "last_fetch_status" text NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS "last_failure_reason" text;

CREATE TABLE IF NOT EXISTS "discovery_ingest_runs" (
  "id" uuid PRIMARY KEY,
  "run_id" text NOT NULL,
  "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
  "source_id" uuid NOT NULL REFERENCES "discovery_sources"("id") ON DELETE CASCADE,
  "status" text NOT NULL,
  "started_at" timestamptz DEFAULT now(),
  "completed_at" timestamptz,
  "duration_ms" integer,
  "failure_reason" text,
  "retry_in_minutes" integer,
  "telemetry_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "discovery_ingest_runs_run_id_unique" ON "discovery_ingest_runs" ("run_id");
