CREATE TABLE IF NOT EXISTS "orchestrator_runs" (
  "run_id" text PRIMARY KEY,
  "thread_id" text,
  "brief_id" uuid,
  "status" text DEFAULT 'pending',
  "plan_snapshot_json" jsonb NOT NULL DEFAULT '{"version":0,"steps":[]}'::jsonb,
  "step_history_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "run_report_json" jsonb,
  "hitl_state_json" jsonb NOT NULL DEFAULT '{"requests":[],"responses":[],"pendingRequestId":null,"deniedCount":0}'::jsonb,
  "execution_context_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "runner_metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "pending_request_id" text,
  "last_error" text,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now(),
  CONSTRAINT "orchestrator_runs_brief_id_briefs_id_fk" FOREIGN KEY ("brief_id") REFERENCES "briefs"("id") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "hitl_requests" (
  "id" text PRIMARY KEY,
  "run_id" text REFERENCES "orchestrator_runs"("run_id") ON DELETE CASCADE,
  "brief_id" uuid REFERENCES "briefs"("id") ON DELETE SET NULL,
  "thread_id" text,
  "step_id" text,
  "origin_agent" text,
  "status" text DEFAULT 'pending',
  "payload_json" jsonb NOT NULL,
  "denial_reason" text,
  "metrics_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now(),
  "updated_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hitl_requests_run_idx" ON "hitl_requests" ("run_id");
CREATE INDEX IF NOT EXISTS "hitl_requests_status_idx" ON "hitl_requests" ("status");

CREATE TABLE IF NOT EXISTS "hitl_responses" (
  "id" text PRIMARY KEY,
  "request_id" text REFERENCES "hitl_requests"("id") ON DELETE CASCADE,
  "response_type" text,
  "selected_option_id" text,
  "freeform_text" text,
  "approved" boolean,
  "responder_id" text,
  "responder_display_name" text,
  "metadata_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "hitl_responses_request_idx" ON "hitl_responses" ("request_id");
