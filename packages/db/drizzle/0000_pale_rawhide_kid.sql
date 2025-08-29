CREATE TABLE "assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"brief_id" uuid,
	"url" text NOT NULL,
	"type" text,
	"meta_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "brief_versions" (
	"brief_id" uuid,
	"version" integer,
	"diff_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"created_by" uuid,
	CONSTRAINT "brief_versions_brief_id_version_pk" PRIMARY KEY("brief_id","version")
);
--> statement-breakpoint
CREATE TABLE "briefs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"title" text,
	"status" text DEFAULT 'draft',
	"objective" text,
	"audience_id" text,
	"deadline_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"objectives_json" jsonb NOT NULL,
	"audiences_json" jsonb NOT NULL,
	"tone_json" jsonb DEFAULT '{}'::jsonb,
	"guardrails_json" jsonb DEFAULT '{}'::jsonb,
	"platform_prefs_json" jsonb DEFAULT '{}'::jsonb,
	"permissions_json" jsonb DEFAULT '{}'::jsonb,
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text,
	"settings_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "clients_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "emails_ingested" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"provider" text,
	"provider_event_id" text,
	"message_id" text,
	"from_email" text,
	"to_email" text,
	"subject" text,
	"raw_url" text,
	"parsed_json" jsonb,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "examples_index" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"platform" text,
	"embedding" jsonb,
	"meta_json" jsonb,
	"perf_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "experiments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"brief_id" uuid,
	"policy" text,
	"arm_json" jsonb,
	"result_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "post_metrics" (
	"post_id" uuid,
	"captured_at" timestamp with time zone,
	"impressions" integer,
	"reactions" integer,
	"comments" integer,
	"shares" integer,
	"clicks" integer,
	"ctr" text,
	"is_boosted" boolean DEFAULT false,
	CONSTRAINT "post_metrics_post_id_captured_at_pk" PRIMARY KEY("post_id","captured_at")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"platform" text,
	"brief_id" uuid,
	"variant_id" text,
	"content_json" jsonb,
	"knobs_json" jsonb,
	"status" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid,
	"type" text,
	"assignee_id" uuid,
	"status" text,
	"due_at" timestamp with time zone,
	"payload_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assets" ADD CONSTRAINT "assets_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brief_versions" ADD CONSTRAINT "brief_versions_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "briefs" ADD CONSTRAINT "briefs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_profiles" ADD CONSTRAINT "client_profiles_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiments" ADD CONSTRAINT "experiments_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_metrics" ADD CONSTRAINT "post_metrics_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;