-- Migration: 4-Knob System Implementation (Simplified)
-- Description: Adds support for the new 4-knob optimization system with telemetry tracking

-- Step 1: Add new fields to existing tables
ALTER TABLE posts ADD COLUMN IF NOT EXISTS knob_payload_json jsonb;

ALTER TABLE post_metrics ADD COLUMN IF NOT EXISTS see_more_expands integer;
ALTER TABLE post_metrics ADD COLUMN IF NOT EXISTS dwell_seconds_est numeric;
ALTER TABLE post_metrics ALTER COLUMN ctr TYPE numeric USING ctr::numeric;

-- Step 2: Create new tables (only if they don't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'knob_experiments') THEN
        CREATE TABLE knob_experiments (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
            post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
            brief_id uuid REFERENCES briefs(id) ON DELETE CASCADE,
            format_type text CHECK (format_type IN ('text','single_image','multi_image','document_pdf','video')),
            hook_intensity numeric CHECK (hook_intensity >= 0.0 AND hook_intensity <= 1.0),
            expertise_depth numeric CHECK (expertise_depth >= 0.0 AND expertise_depth <= 1.0),
            length_level numeric CHECK (length_level >= 0.0 AND length_level <= 1.0),
            scan_density numeric CHECK (scan_density >= 0.0 AND scan_density <= 1.0),
            assets_count integer,
            created_at timestamptz DEFAULT now()
        );
    END IF;
END $$;

DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'post_telemetry') THEN
        CREATE TABLE post_telemetry (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
            client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
            knobs_json jsonb,
            observables_json jsonb,
            derived_metrics_json jsonb,
            render_metrics_json jsonb,
            captured_at timestamptz DEFAULT now()
        );
    END IF;
END $$;

-- Step 3: Create indexes (only if they don't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_knob_experiments_client_id') THEN
        CREATE INDEX idx_knob_experiments_client_id ON knob_experiments(client_id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_knob_experiments_post_id') THEN
        CREATE INDEX idx_knob_experiments_post_id ON knob_experiments(post_id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_knob_experiments_brief_id') THEN
        CREATE INDEX idx_knob_experiments_brief_id ON knob_experiments(brief_id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_knob_experiments_format_type') THEN
        CREATE INDEX idx_knob_experiments_format_type ON knob_experiments(format_type);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_knob_experiments_created_at') THEN
        CREATE INDEX idx_knob_experiments_created_at ON knob_experiments(created_at);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_post_telemetry_post_id') THEN
        CREATE INDEX idx_post_telemetry_post_id ON post_telemetry(post_id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_post_telemetry_client_id') THEN
        CREATE INDEX idx_post_telemetry_client_id ON post_telemetry(client_id);
    END IF;
    
    IF NOT EXISTS (SELECT FROM pg_indexes WHERE indexname = 'idx_post_telemetry_captured_at') THEN
        CREATE INDEX idx_post_telemetry_captured_at ON post_telemetry(captured_at);
    END IF;
END $$;

-- Step 4: Add comments for documentation
COMMENT ON COLUMN posts.knob_payload_json IS 'Complete knob settings and client policy for the post';
COMMENT ON COLUMN post_metrics.see_more_expands IS 'Number of LinkedIn "see more" clicks for content depth analysis';
COMMENT ON COLUMN post_metrics.dwell_seconds_est IS 'Estimated reading time in seconds for content quality assessment';

DO $$ 
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'knob_experiments') THEN
        COMMENT ON TABLE knob_experiments IS 'Tracks knob settings used for each post to enable correlation analysis and bandit learning';
    END IF;
    
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'post_telemetry') THEN
        COMMENT ON TABLE post_telemetry IS 'Comprehensive performance tracking including knob settings, raw metrics, derived metrics, and render analysis';
    END IF;
END $$;
