-- Migration: Add description to briefs and enhance assets table
-- Applied manually on database

-- Add description field to briefs table
ALTER TABLE "briefs" ADD COLUMN "description" text;

-- Add new fields to assets table for better file management
ALTER TABLE "assets" ADD COLUMN "filename" text;
ALTER TABLE "assets" ADD COLUMN "original_name" text;
ALTER TABLE "assets" ADD COLUMN "mime_type" text;
ALTER TABLE "assets" ADD COLUMN "file_size" integer;
ALTER TABLE "assets" ADD COLUMN "created_by" uuid;

-- Update foreign key constraint to CASCADE delete
ALTER TABLE "assets" DROP CONSTRAINT IF EXISTS "assets_brief_id_briefs_id_fk";
ALTER TABLE "assets" ADD CONSTRAINT "assets_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;
