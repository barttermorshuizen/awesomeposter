ALTER TABLE flex_capabilities
  ADD COLUMN IF NOT EXISTS post_conditions_dsl_json jsonb,
  ADD COLUMN IF NOT EXISTS post_conditions_compiled_json jsonb;
