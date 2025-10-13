ALTER TABLE flex_capabilities
    DROP COLUMN IF EXISTS default_contract_json;

ALTER TABLE flex_capabilities
    ADD COLUMN IF NOT EXISTS input_contract_json JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS output_contract_json JSONB DEFAULT NULL;
