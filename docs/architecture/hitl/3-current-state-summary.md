# 3. Current State Summary
- **Agents server (`packages/agents-server`)**: `OrchestratorEngine` drives plan→step→replan loop. `HitlService` + `HitlRepository` already define APIs to raise requests, persist state, and apply responses. `withHitlContext` wraps specialist step execution.
- **Nitro API (`server/api`)**: `/api/hitl/pending`, `/api/hitl/resume`, `/api/hitl/remove` expose persistence operations with bearer auth (see `server/utils/api-auth`).
- **Vue SPA (`src/components/AgentResultsPopup.vue`)**: Consumes orchestrator SSE stream but lacks dedicated HITL panel/state.
- **Database (`packages/db/src/schema.ts`)**: `orchestrator_runs` stores plan snapshots + `hitl_state_json`; `hitl_requests` and `hitl_responses` tables exist with minimal usage. No dedicated indices yet.
- **Docs & Ops**: Runbook in `docs/orchestrator-hitl-runbook.md` covers manual resume/remove flows.
