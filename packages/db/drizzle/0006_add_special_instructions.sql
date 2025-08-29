-- Add special_instructions_json column to client_profiles table
ALTER TABLE client_profiles ADD COLUMN special_instructions_json jsonb DEFAULT '{}';
