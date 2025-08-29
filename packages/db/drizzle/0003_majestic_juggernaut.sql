CREATE TABLE "knob_experiments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"post_id" uuid,
	"brief_id" uuid,
	"format_type" text,
	"hook_intensity" numeric,
	"expertise_depth" numeric,
	"length_level" numeric,
	"scan_density" numeric,
	"assets_count" integer,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "post_telemetry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"post_id" uuid,
	"client_id" uuid,
	"knobs_json" jsonb,
	"observables_json" jsonb,
	"derived_metrics_json" jsonb,
	"render_metrics_json" jsonb,
	"captured_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "assets" ALTER COLUMN "filename" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "post_metrics" ALTER COLUMN "ctr" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "primary_communication_language" text;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD COLUMN "see_more_expands" integer;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD COLUMN "dwell_seconds_est" numeric;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "knob_payload_json" jsonb;--> statement-breakpoint
ALTER TABLE "knob_experiments" ADD CONSTRAINT "knob_experiments_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knob_experiments" ADD CONSTRAINT "knob_experiments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knob_experiments" ADD CONSTRAINT "knob_experiments_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_telemetry" ADD CONSTRAINT "post_telemetry_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_telemetry" ADD CONSTRAINT "post_telemetry_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;