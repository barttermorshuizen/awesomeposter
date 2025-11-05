CREATE EXTENSION IF NOT EXISTS "vector";

CREATE TABLE IF NOT EXISTS flex_capability_snippets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corpus_id text NOT NULL,
  chunk_id text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL,
  body text NOT NULL,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL,
  embedding vector(1536) NOT NULL,
  embedding_model text NOT NULL,
  score_boost numeric NOT NULL DEFAULT 0,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corpus_id, chunk_id)
);

CREATE INDEX IF NOT EXISTS flex_capability_snippets_corpus_idx ON flex_capability_snippets (corpus_id);
CREATE INDEX IF NOT EXISTS flex_capability_snippets_tags_idx ON flex_capability_snippets USING GIN (tags);
CREATE INDEX IF NOT EXISTS flex_capability_snippets_updated_at_idx ON flex_capability_snippets (updated_at DESC);
CREATE INDEX IF NOT EXISTS flex_capability_snippets_embedding_idx
  ON flex_capability_snippets
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
