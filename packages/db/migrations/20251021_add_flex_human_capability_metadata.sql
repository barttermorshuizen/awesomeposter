ALTER TABLE flex_capabilities
  ADD COLUMN agent_type text NOT NULL DEFAULT 'ai',
  ADD COLUMN instruction_templates_json jsonb DEFAULT NULL,
  ADD COLUMN assignment_defaults_json jsonb DEFAULT NULL;

UPDATE flex_capabilities
SET agent_type = 'ai'
WHERE agent_type IS NULL;
