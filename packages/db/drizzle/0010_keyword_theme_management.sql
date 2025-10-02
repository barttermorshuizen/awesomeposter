CREATE TABLE IF NOT EXISTS "discovery_keywords" (
    "id" uuid PRIMARY KEY NOT NULL,
    "client_id" uuid NOT NULL,
    "keyword" text NOT NULL,
    "keyword_alias" text NOT NULL,
    "added_by" text,
    "created_at" timestamp with time zone DEFAULT now(),
    "updated_at" timestamp with time zone DEFAULT now(),
    CONSTRAINT "discovery_keywords_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE cascade
);

CREATE UNIQUE INDEX IF NOT EXISTS "discovery_keywords_client_alias_unique"
  ON "discovery_keywords" ("client_id", "keyword_alias");
