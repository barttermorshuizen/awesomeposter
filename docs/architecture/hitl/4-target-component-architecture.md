# 4. Target Component Architecture
```
┌────────────────────────────────────────────┐
│ Vue SPA (`AgentResultsPopup` + HITL store) │
│  • Renders plan + HITL panel               │
│  • Calls Nitro HITL APIs                   │
│  • Streams SSE from orchestrator           │
└──────────────▲────────────────────────────┘
               │ HITL actions (resume/cancel)
               │ SSE status updates
┌──────────────┴────────────────────────────┐
│ Nitro API (`server/api/hitl/*`)           │
│  • Authn via bearer token                 │
│  • Validates payloads with Zod            │
│  • Delegates to orchestrator persistence  │
└──────────────▲────────────────────────────┘
               │ repository/service calls
┌──────────────┴────────────────────────────┐
│ Agents Server (`packages/agents-server`)  │
│  • `OrchestratorEngine` invokes specialists│
│  • `HitlService` raises/records requests   │
│  • `HitlRepository` persists via Drizzle   │
│  • Emits SSE via Agent runtime             │
└──────────────▲────────────────────────────┘
               │ SQL (Drizzle/Postgres)
┌──────────────┴────────────────────────────┐
│ Postgres (`packages/db` schema)           │
│  • `orchestrator_runs` snapshot           │
│  • `hitl_requests` / `hitl_responses`     │
└───────────────────────────────────────────┘
```

## 4.1 Agents Server Responsibilities
- Wrap each specialist step execution in `withHitlContext` (already wired around line ~720 of `orchestrator-engine.ts`) so `HitlService.raiseRequest` can enforce per-run limits and capture context (`runId`, `threadId`, `stepId`, `originAgent`).
- Emit HITL snapshots to persistence immediately after any mutation (`HitlRepository.setRunState` → `OrchestratorPersistence.save`).
- Surface HITL-related SSE events: extend `signalHitlRequest` handler to push `agent_event` type `hitl_request` frames that the UI can subscribe to (mirrors existing plan updates).
- Ensure resume path replays persisted `hitlState.responses` into LLM prompts (inject in `buildPayloadForCapability`).

## 4.2 Nitro API Layer
- `pending.get.ts`: list awaiting runs with joined request metadata for dashboards.
- `resume.post.ts`: append operator responses, transition run to `running`, append audit log in `runnerMetadata.auditLog`.
- `remove.post.ts`: mark request denied, set run status `cancelled`, log operator action.
- All handlers must assert feature flag + bearer auth, return 4xx for stale/mismatched runs to avoid silent corruption.

## 4.3 Front-End Integration
- Augment `AgentResultsPopup.vue` with a dedicated HITL panel component (`src/components/hitl/HitlPanel.vue`) fed by a Pinia store (`src/stores/hitl.ts`).
  - Store tracks `pendingRequests`, `selectedRequest`, `responses`, derived `awaitingRunId`.
  - Store listens to SSE frames of type `hitl_request`, `hitl_update`, `hitl_resolved` and fetches `/api/hitl/pending` as fallback on reconnect.
  - Panel presents request metadata (origin agent badge, timestamp, question/options) and exposes actions: Answer (resume) and Cancel (remove).
- Use Vuetify dialogs consistent with existing popup styling; ensure responsive layout for smaller viewports.

## 4.4 Persistence & Data Model
- `orchestrator_runs`
  - `pending_request_id` and `hitl_state_json` remain source of truth for orchestrator status.
  - Add B-tree index on (`status`, `pending_request_id`) via migration to accelerate `listAwaitingHitl`.
- `hitl_requests`
  - Entries inserted via repository with consistent timestamps; include `brief_id`, `thread_id` for reporting.
  - Add index on `run_id` + `status` to support dashboards.
- `hitl_responses`
  - Append-only audit trail; `request_id` fk cascades on request deletion.
