ALTER TABLE flex_capabilities
ADD COLUMN kind text;

UPDATE flex_capabilities
SET kind = 'structuring'
WHERE
  kind IS NULL
  AND (
    lower(capability_id) LIKE '%strategy%' OR
    lower(capability_id) LIKE '%planner%' OR
    lower(display_name) LIKE '%strateg%' OR
    lower(summary) LIKE '%brief%'
  );

UPDATE flex_capabilities
SET kind = 'validation'
WHERE
  kind IS NULL
  AND (
    lower(capability_id) LIKE '%review%' OR
    lower(capability_id) LIKE '%qa%' OR
    lower(display_name) LIKE '%review%' OR
    lower(summary) LIKE '%review%'
  );

UPDATE flex_capabilities
SET kind = 'transformation'
WHERE
  kind IS NULL
  AND (
    lower(capability_id) LIKE '%transform%' OR
    lower(summary) LIKE '%transform%' OR
    lower(summary) LIKE '%normalize%'
  );

UPDATE flex_capabilities
SET kind = 'execution'
WHERE kind IS NULL;

ALTER TABLE flex_capabilities
ALTER COLUMN kind SET NOT NULL;

ALTER TABLE flex_capabilities
ADD CONSTRAINT flex_capabilities_kind_check
CHECK (kind IN ('structuring', 'execution', 'validation', 'transformation', 'routing'));
