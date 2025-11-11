ALTER TABLE flex_run_outputs
  ADD COLUMN IF NOT EXISTS goal_condition_results_json jsonb;
