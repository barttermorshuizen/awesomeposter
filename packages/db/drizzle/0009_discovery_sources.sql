CREATE TABLE IF NOT EXISTS "discovery_sources" (
  "id" uuid PRIMARY KEY NOT NULL,
  "client_id" uuid NOT NULL,
  "url" text NOT NULL,
  "canonical_url" text NOT NULL,
  "source_type" text NOT NULL,
  "identifier" text NOT NULL,
  "notes" text,
  "config_json" jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

ALTER TABLE "discovery_sources"
  ADD CONSTRAINT "discovery_sources_client_id_clients_id_fk"
  FOREIGN KEY ("client_id") REFERENCES "clients"("id")
  ON DELETE cascade;

CREATE UNIQUE INDEX IF NOT EXISTS "discovery_sources_client_identifier_unique"
  ON "discovery_sources" ("client_id", "source_type", "identifier");
