-- Adds composite indexes to support discovery search endpoint performance
CREATE INDEX IF NOT EXISTS discovery_items_client_status_ingested_idx
  ON discovery_items (client_id, status, ingested_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS discovery_items_client_source_ingested_idx
  ON discovery_items (client_id, source_id, ingested_at DESC);

CREATE INDEX IF NOT EXISTS discovery_items_client_published_idx
  ON discovery_items (client_id, published_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS discovery_items_search_vector_idx
  ON discovery_items
  USING GIN (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' ||
      coalesce(normalized_json->>'excerpt', '') || ' ' ||
      coalesce(normalized_json->>'extractedBody', '')
    )
  );
