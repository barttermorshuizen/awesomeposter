-- Migration: Map legacy tone presets to new 7-option set
-- Legacy mapping:
--   Professional -> Professional & Formal
--   Friendly    -> Warm & Friendly
--   Bold        -> Confident & Bold

BEGIN;

-- 1) Remap existing 'preset' values in tone_json
UPDATE client_profiles
SET tone_json = jsonb_set(
  COALESCE(tone_json, '{}'::jsonb),
  '{preset}',
  to_jsonb(
    CASE tone_json->>'preset'
      WHEN 'Professional' THEN 'Professional & Formal'
      WHEN 'Friendly'     THEN 'Warm & Friendly'
      WHEN 'Bold'         THEN 'Confident & Bold'
      ELSE tone_json->>'preset'
    END
  )
)
WHERE tone_json ? 'preset'
  AND tone_json->>'preset' IN ('Professional', 'Friendly', 'Bold');

-- 2) If no 'preset' set, derive from legacy 'style' when it matches a known legacy option
UPDATE client_profiles
SET tone_json = jsonb_set(
  COALESCE(tone_json, '{}'::jsonb),
  '{preset}',
  to_jsonb(
    CASE tone_json->>'style'
      WHEN 'Professional' THEN 'Professional & Formal'
      WHEN 'Friendly'     THEN 'Warm & Friendly'
      WHEN 'Bold'         THEN 'Confident & Bold'
    END
  )
)
WHERE (NOT (tone_json ? 'preset') OR tone_json->>'preset' IS NULL OR tone_json->>'preset' = '')
  AND tone_json ? 'style'
  AND tone_json->>'style' IN ('Professional', 'Friendly', 'Bold');

COMMIT;