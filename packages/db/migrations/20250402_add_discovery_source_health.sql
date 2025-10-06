ALTER TABLE discovery_sources
  ADD COLUMN last_success_at timestamptz,
  ADD COLUMN consecutive_failure_count integer NOT NULL DEFAULT 0,
  ADD COLUMN health_json jsonb NOT NULL DEFAULT '{}';

UPDATE discovery_sources
SET
  last_success_at = CASE WHEN last_fetch_status = 'success' THEN last_fetch_completed_at ELSE last_success_at END,
  consecutive_failure_count = CASE WHEN last_fetch_status = 'failure' THEN 1 ELSE consecutive_failure_count END,
  health_json = jsonb_strip_nulls(
    jsonb_build_object(
      'status', CASE WHEN last_fetch_status = 'failure' THEN 'warning' ELSE 'healthy' END,
      'observedAt', COALESCE(last_fetch_completed_at, updated_at, created_at, NOW())::text,
      'lastFetchedAt', last_fetch_completed_at::text,
      'consecutiveFailures', CASE WHEN last_fetch_status = 'failure' THEN 1 ELSE 0 END,
      'failureReason', last_failure_reason
    )
  );
