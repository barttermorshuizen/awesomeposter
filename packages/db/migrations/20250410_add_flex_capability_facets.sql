ALTER TABLE flex_capabilities
    ADD COLUMN IF NOT EXISTS input_facets TEXT[] DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN IF NOT EXISTS output_facets TEXT[] DEFAULT ARRAY[]::TEXT[];

UPDATE flex_capabilities
SET input_facets = COALESCE(input_facets, ARRAY[]::TEXT[]),
    output_facets = COALESCE(output_facets, ARRAY[]::TEXT[]);
