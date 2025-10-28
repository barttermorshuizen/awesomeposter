# 9. Data Model & Persistence
- `flex_runs`: mirrors `orchestrator_runs` but records envelope metadata (`objective`, `schema_hash`, `persona`, `variant_policy`) plus persisted run context (`hitlClarifications` storing the structured clarify question/answer history).
- `flex_plan_nodes`: stores node-level state, selected capability IDs, context hashes, and validation status for auditing and resumption.
- `flex_plan_snapshots`: versioned checkpoints serializing plan graphs (node facets, compiled contracts, provenance, pending node IDs) and the facet snapshot used for resume/HITL flows.
- `flex_run_outputs`: captures validated final payloads, schema hashes, plan version, facet snapshot, provenance map, completion status, and timestamps so downstream systems can audit or resume runs.
- `flex_capabilities`: stores registered agent metadata, heartbeat timestamps, availability state, and facet coverage hints.
- Reuse `agent_messages` and `hitl_requests` tables, adding `flex_run_id` foreign keys for joint reporting.
