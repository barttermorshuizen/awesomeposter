ALTER TABLE "hitl_requests" ADD COLUMN IF NOT EXISTS "pending_node_id" text;
ALTER TABLE "hitl_requests" ADD COLUMN IF NOT EXISTS "contract_summary_json" jsonb;
ALTER TABLE "hitl_requests" ADD COLUMN IF NOT EXISTS "operator_prompt" text;
