CREATE TABLE "flex_capability_snippets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"corpus_id" text NOT NULL,
	"chunk_id" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"body" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"source" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"embedding_model" text NOT NULL,
	"score_boost" numeric DEFAULT '0' NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"refreshed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "flex_capability_snippets_chunk_unique" UNIQUE("corpus_id","chunk_id")
);
--> statement-breakpoint
CREATE TABLE "discovery_bulk_action_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"action_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"action" text NOT NULL,
	"note" text,
	"filters_snapshot" jsonb DEFAULT 'null'::jsonb,
	"item_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"success_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"conflict_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"failed_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"success_brief_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL,
	"results_json" jsonb NOT NULL,
	"success_count" integer DEFAULT 0 NOT NULL,
	"conflict_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"total_count" integer NOT NULL,
	"duration_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discovery_bulk_action_audits_action_id_unique" UNIQUE("action_id")
);
--> statement-breakpoint
CREATE TABLE "flex_assets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assignment_id" text NOT NULL,
	"run_id" text,
	"node_id" text,
	"facet" text NOT NULL,
	"url" text NOT NULL,
	"filename" text NOT NULL,
	"original_name" text,
	"mime_type" text,
	"file_size" integer,
	"ordering" integer DEFAULT 0,
	"meta_json" jsonb DEFAULT '{}'::jsonb,
	"uploaded_by" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "flex_plan_snapshots" (
	"run_id" text NOT NULL,
	"plan_version" integer NOT NULL,
	"snapshot_json" jsonb NOT NULL,
	"facet_snapshot_json" jsonb DEFAULT 'null'::jsonb,
	"schema_hash" text,
	"pending_node_ids" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "flex_plan_snapshots_run_id_plan_version_pk" PRIMARY KEY("run_id","plan_version")
);
--> statement-breakpoint
CREATE TABLE "flex_run_outputs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"plan_version" integer NOT NULL,
	"schema_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"output_json" jsonb NOT NULL,
	"facet_snapshot_json" jsonb DEFAULT 'null'::jsonb,
	"provenance_json" jsonb DEFAULT 'null'::jsonb,
	"goal_condition_results_json" jsonb DEFAULT 'null'::jsonb,
	"recorded_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "hitl_requests" ALTER COLUMN "contract_summary_json" SET DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "flex_capabilities" ADD COLUMN "agent_type" text DEFAULT 'ai' NOT NULL;--> statement-breakpoint
ALTER TABLE "flex_capabilities" ADD COLUMN "instruction_templates_json" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "flex_capabilities" ADD COLUMN "assignment_defaults_json" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "flex_capabilities" ADD COLUMN "post_conditions_dsl_json" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "flex_capabilities" ADD COLUMN "post_conditions_compiled_json" jsonb DEFAULT 'null'::jsonb;--> statement-breakpoint
ALTER TABLE "discovery_bulk_action_audits" ADD CONSTRAINT "discovery_bulk_action_audits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flex_plan_snapshots" ADD CONSTRAINT "flex_plan_snapshots_run_id_flex_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flex_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flex_run_outputs" ADD CONSTRAINT "flex_run_outputs_run_id_flex_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flex_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "flex_capability_snippets_corpus_idx" ON "flex_capability_snippets" USING btree ("corpus_id");--> statement-breakpoint
CREATE INDEX "discovery_bulk_action_audits_client_idx" ON "discovery_bulk_action_audits" USING btree ("client_id","created_at");--> statement-breakpoint
CREATE INDEX "discovery_bulk_action_audits_action_idx" ON "discovery_bulk_action_audits" USING btree ("action","created_at");