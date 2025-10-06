-- Adds constraints and sanity checks for discovery_scores table
ALTER TABLE discovery_scores
  ADD CONSTRAINT discovery_scores_score_range CHECK (score >= 0 AND score <= 1),
  ADD CONSTRAINT discovery_scores_keyword_range CHECK (keyword_score >= 0 AND keyword_score <= 1),
  ADD CONSTRAINT discovery_scores_recency_range CHECK (recency_score >= 0 AND recency_score <= 1),
  ADD CONSTRAINT discovery_scores_source_range CHECK (source_score >= 0 AND source_score <= 1),
  ADD CONSTRAINT discovery_scores_threshold_range CHECK (applied_threshold >= 0 AND applied_threshold <= 1),
  ADD CONSTRAINT discovery_scores_status_valid CHECK (status_outcome IN ('scored', 'suppressed'));

CREATE INDEX IF NOT EXISTS discovery_scores_status_idx ON discovery_scores (status_outcome);
