CREATE TABLE "client_feature_toggle_audits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"previous_enabled" boolean NOT NULL,
	"new_enabled" boolean NOT NULL,
	"actor" text NOT NULL,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "client_features" (
	"client_id" uuid NOT NULL,
	"feature" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "client_features_client_id_feature_pk" PRIMARY KEY("client_id","feature")
);
--> statement-breakpoint
CREATE TABLE "discovery_ingest_runs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"client_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now(),
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"failure_reason" text,
	"retry_in_minutes" integer,
	"metrics_json" jsonb DEFAULT '{}'::jsonb,
	"telemetry_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discovery_ingest_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint
CREATE TABLE "discovery_item_status_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"item_id" uuid NOT NULL,
	"previous_status" text,
	"next_status" text NOT NULL,
	"note" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discovery_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"raw_hash" text NOT NULL,
	"status" text DEFAULT 'pending_scoring' NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"published_at" timestamp with time zone,
	"published_at_source" text NOT NULL,
	"ingested_at" timestamp with time zone DEFAULT now(),
	"raw_payload_json" jsonb NOT NULL,
	"normalized_json" jsonb NOT NULL,
	"source_metadata_json" jsonb NOT NULL,
	"brief_id" uuid
);
--> statement-breakpoint
CREATE TABLE "discovery_keywords" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"keyword" text NOT NULL,
	"keyword_alias" text NOT NULL,
	"added_by" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discovery_keywords_client_alias_unique" UNIQUE("client_id","keyword_alias")
);
--> statement-breakpoint
CREATE TABLE "discovery_scores" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"score" numeric NOT NULL,
	"keyword_score" numeric DEFAULT '0' NOT NULL,
	"recency_score" numeric DEFAULT '0' NOT NULL,
	"source_score" numeric DEFAULT '0' NOT NULL,
	"applied_threshold" numeric NOT NULL,
	"weights_version" integer DEFAULT 1 NOT NULL,
	"components_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rationale_json" jsonb DEFAULT 'null'::jsonb,
	"knobs_hint_json" jsonb DEFAULT 'null'::jsonb,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_outcome" text NOT NULL,
	"scored_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "discovery_sources" (
	"id" uuid PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"source_type" text NOT NULL,
	"identifier" text NOT NULL,
	"notes" text,
	"config_json" jsonb DEFAULT 'null'::jsonb,
	"fetch_interval_minutes" integer DEFAULT 60 NOT NULL,
	"next_fetch_at" timestamp with time zone DEFAULT now(),
	"last_fetch_started_at" timestamp with time zone,
	"last_fetch_completed_at" timestamp with time zone,
	"last_fetch_status" text DEFAULT 'idle',
	"last_failure_reason" text,
	"last_success_at" timestamp with time zone,
	"consecutive_failure_count" integer DEFAULT 0 NOT NULL,
	"health_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "discovery_sources_client_identifier_unique" UNIQUE("client_id","source_type","identifier")
);
--> statement-breakpoint
CREATE TABLE "flex_capabilities" (
	"capability_id" text NOT NULL,
	"version" text NOT NULL,
	"display_name" text NOT NULL,
	"summary" text NOT NULL,
	"input_traits_json" jsonb DEFAULT 'null'::jsonb,
	"input_contract_json" jsonb DEFAULT 'null'::jsonb,
	"output_contract_json" jsonb DEFAULT 'null'::jsonb,
	"input_facets" text[] DEFAULT ARRAY[]::text[],
	"output_facets" text[] DEFAULT ARRAY[]::text[],
	"cost_json" jsonb DEFAULT 'null'::jsonb,
	"preferred_models" text[] DEFAULT ARRAY[]::text[],
	"heartbeat_json" jsonb DEFAULT 'null'::jsonb,
	"metadata_json" jsonb DEFAULT 'null'::jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"last_seen_at" timestamp with time zone,
	"registered_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "flex_capabilities_capability_id_pk" PRIMARY KEY("capability_id")
);
--> statement-breakpoint
CREATE TABLE "flex_plan_nodes" (
	"run_id" text NOT NULL,
	"node_id" text NOT NULL,
	"capability_id" text,
	"label" text,
	"status" text DEFAULT 'pending',
	"context_json" jsonb DEFAULT '{}'::jsonb,
	"output_json" jsonb DEFAULT 'null'::jsonb,
	"error_json" jsonb DEFAULT 'null'::jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "flex_plan_nodes_run_id_node_id_pk" PRIMARY KEY("run_id","node_id")
);
--> statement-breakpoint
CREATE TABLE "flex_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"status" text DEFAULT 'pending',
	"objective" text,
	"envelope_json" jsonb NOT NULL,
	"schema_hash" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb,
	"result_json" jsonb DEFAULT 'null'::jsonb,
	"context_snapshot_json" jsonb DEFAULT '{}'::jsonb,
	"plan_version" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hitl_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text,
	"brief_id" uuid,
	"thread_id" text,
	"step_id" text,
	"origin_agent" text,
	"status" text DEFAULT 'pending',
	"payload_json" jsonb NOT NULL,
	"denial_reason" text,
	"metrics_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "hitl_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text,
	"response_type" text,
	"selected_option_id" text,
	"freeform_text" text,
	"approved" boolean,
	"responder_id" text,
	"responder_display_name" text,
	"metadata_json" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "orchestrator_runs" (
	"run_id" text PRIMARY KEY NOT NULL,
	"thread_id" text,
	"brief_id" uuid,
	"status" text DEFAULT 'pending',
	"plan_snapshot_json" jsonb DEFAULT '{"version":0,"steps":[]}'::jsonb,
	"step_history_json" jsonb DEFAULT '[]'::jsonb,
	"run_report_json" jsonb DEFAULT 'null'::jsonb,
	"hitl_state_json" jsonb DEFAULT '{"requests":[],"responses":[],"pendingRequestId":null,"deniedCount":0}'::jsonb,
	"execution_context_json" jsonb DEFAULT '{}'::jsonb,
	"runner_metadata_json" jsonb DEFAULT '{}'::jsonb,
	"pending_request_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "client_profiles" ADD COLUMN "special_instructions_json" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "client_feature_toggle_audits" ADD CONSTRAINT "client_feature_toggle_audits_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_features" ADD CONSTRAINT "client_features_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_ingest_runs" ADD CONSTRAINT "discovery_ingest_runs_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_ingest_runs" ADD CONSTRAINT "discovery_ingest_runs_source_id_discovery_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_item_status_history" ADD CONSTRAINT "discovery_item_status_history_item_id_discovery_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."discovery_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_source_id_discovery_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."discovery_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_items" ADD CONSTRAINT "discovery_items_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_keywords" ADD CONSTRAINT "discovery_keywords_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_scores" ADD CONSTRAINT "discovery_scores_item_id_discovery_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."discovery_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_sources" ADD CONSTRAINT "discovery_sources_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "flex_plan_nodes" ADD CONSTRAINT "flex_plan_nodes_run_id_flex_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."flex_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitl_requests" ADD CONSTRAINT "hitl_requests_run_id_orchestrator_runs_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."orchestrator_runs"("run_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitl_requests" ADD CONSTRAINT "hitl_requests_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hitl_responses" ADD CONSTRAINT "hitl_responses_request_id_hitl_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."hitl_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_runs" ADD CONSTRAINT "orchestrator_runs_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "public"."briefs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "discovery_item_status_history_item_idx" ON "discovery_item_status_history" USING btree ("item_id");--> statement-breakpoint
CREATE INDEX "discovery_item_status_history_created_idx" ON "discovery_item_status_history" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_items_client_hash_unique" ON "discovery_items" USING btree ("client_id","raw_hash");--> statement-breakpoint
CREATE INDEX "discovery_items_status_idx" ON "discovery_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "discovery_items_source_idx" ON "discovery_items" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_sources_client_identifier_lower_unique" ON "discovery_sources" USING btree ("client_id","source_type",lower("identifier"));--> statement-breakpoint
CREATE INDEX "flex_capabilities_status_idx" ON "flex_capabilities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "flex_capabilities_last_seen_idx" ON "flex_capabilities" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "flex_plan_nodes_status_idx" ON "flex_plan_nodes" USING btree ("status");