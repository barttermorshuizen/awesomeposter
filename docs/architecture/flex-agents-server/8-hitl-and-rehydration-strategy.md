# 8. HITL and Rehydration Strategy
- Maintain existing HITL tables (`hitl_requests`, `hitl_events`) while persisting plan checkpoints to `flex_plan_snapshots` so every pause captures outstanding nodes, facet snapshots, and pending node IDs.
- When a HITL request fires, the execution engine writes a transactional snapshot pairing the paused node’s bundle, compiled input/output schemas, and provenance metadata with the current facet state so operators have full context.
- Rehydration reconstructs the `PlanGraph` from the latest `flex_plan_snapshots` row plus persisted outputs. Pending node IDs and stored facet provenance restore execution deterministically before policy refresh and resume.
- HITL request rows now persist `pending_node_id`, `contract_summary_json`, and `operator_prompt`, allowing the coordinator to replay the exact node contract (facets + schema expectations) and the orchestrator-authored guidance string without recomputing metadata during resume.
