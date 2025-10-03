DO $$
BEGIN
  DELETE FROM "discovery_sources"
  WHERE "id" IN (
    SELECT "id"
    FROM (
      SELECT "id",
             ROW_NUMBER() OVER (
               PARTITION BY "client_id", "source_type", LOWER("identifier")
               ORDER BY "created_at" ASC
             ) AS rn
      FROM "discovery_sources"
    ) dedup
    WHERE dedup.rn > 1
  );
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "discovery_sources_client_identifier_lower_unique"
  ON "discovery_sources" ("client_id", "source_type", LOWER("identifier"));
