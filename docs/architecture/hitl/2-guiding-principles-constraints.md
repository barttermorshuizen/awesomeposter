# 2. Guiding Principles & Constraints
- **Feature-flagged rollout**: Gate HITL behaviour behind `ENABLE_HITL` (Nitro + UI) and `HITL_MAX_REQUESTS` (agents server). Default off in production until QA complete.
- **Additive persistence**: Only additive migrations on `orchestrator_runs`, `hitl_requests`, `hitl_responses` (see `packages/db/src/schema.ts`). Existing columns stay backward compatible.
- **Orchestrator first-class**: Orchestrator engine owns HITL lifecycle; Nitro and UI act as clients.
- **Deterministic recovery**: Persist enough state to resume after orchestrator/Nitro restarts.
- **Operational safety**: Resume/remove endpoints require internal auth and produce auditable trails.
