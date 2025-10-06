-- Introduces discovery_scores table for relevance scoring outputs
CREATE TABLE IF NOT EXISTS discovery_scores (
  item_id uuid PRIMARY KEY REFERENCES discovery_items(id) ON DELETE CASCADE,
  score numeric NOT NULL,
  keyword_score numeric NOT NULL DEFAULT 0,
  recency_score numeric NOT NULL DEFAULT 0,
  source_score numeric NOT NULL DEFAULT 0,
  applied_threshold numeric NOT NULL,
  weights_version integer NOT NULL DEFAULT 1,
  components_json jsonb NOT NULL DEFAULT '{}',
  rationale_json jsonb,
  knobs_hint_json jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}',
  status_outcome text NOT NULL,
  scored_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS discovery_scores_scored_at_idx ON discovery_scores (scored_at DESC);
