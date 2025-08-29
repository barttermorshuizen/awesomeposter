-- Add primary communication language to client profiles
ALTER TABLE client_profiles ADD COLUMN primary_communication_language text;
