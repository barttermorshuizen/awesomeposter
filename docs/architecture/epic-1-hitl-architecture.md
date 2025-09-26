# Epic HITL-1 Architecture — Human-in-the-Loop Orchestration

## 1. Purpose & Scope
- Deliver a reusable human-in-the-loop (HITL) capability that any specialist agent can trigger during an orchestrated run.
- Keep existing automated orchestration flows working when HITL is not exercised (brownfield enhancement, additive only).
- Cover orchestration engine changes (`packages/agents-server`), Nitro API surfaces (`server/api/hitl`), Vue operator UI (`src/components/AgentResultsPopup.vue` + supporting stores), persistence (`packages/db`), and supporting telemetry.
- Outside scope: net-new specialist agents, major UX redesign of the create-post experience, or non-post workflows.

## 2. Guiding Principles & Constraints
- **Feature-flagged rollout**: Gate HITL behaviour behind `ENABLE_HITL` (Nitro + UI) and `HITL_MAX_REQUESTS` (agents server). Default off in production until QA complete.
- **Additive persistence**: Only additive migrations on `orchestrator_runs`, `hitl_requests`, `hitl_responses` (see `packages/db/src/schema.ts`). Existing columns stay backward compatible.
- **Orchestrator first-class**: Orchestrator engine owns HITL lifecycle; Nitro and UI act as clients.
- **Deterministic recovery**: Persist enough state to resume after orchestrator/Nitro restarts.
- **Operational safety**: Resume/remove endpoints require internal auth and produce auditable trails.

## 3. Current State Summary
- **Agents server (`packages/agents-server`)**: `OrchestratorEngine` drives plan→step→replan loop. `HitlService` + `HitlRepository` already define APIs to raise requests, persist state, and apply responses. `withHitlContext` wraps specialist step execution.
- **Nitro API (`server/api`)**: `/api/hitl/pending`, `/api/hitl/resume`, `/api/hitl/remove` expose persistence operations with bearer auth (see `server/utils/api-auth`).
- **Vue SPA (`src/components/AgentResultsPopup.vue`)**: Consumes orchestrator SSE stream but lacks dedicated HITL panel/state.
- **Database (`packages/db/src/schema.ts`)**: `orchestrator_runs` stores plan snapshots + `hitl_state_json`; `hitl_requests` and `hitl_responses` tables exist with minimal usage. No dedicated indices yet.
- **Docs & Ops**: Runbook in `docs/orchestrator-hitl-runbook.md` covers manual resume/remove flows.

## 4. Target Component Architecture
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

### 4.1 Agents Server Responsibilities
- Wrap each specialist step execution in `withHitlContext` (already wired around line ~720 of `orchestrator-engine.ts`) so `HitlService.raiseRequest` can enforce per-run limits and capture context (`runId`, `threadId`, `stepId`, `originAgent`).
- Emit HITL snapshots to persistence immediately after any mutation (`HitlRepository.setRunState` → `OrchestratorPersistence.save`).
- Surface HITL-related SSE events: extend `signalHitlRequest` handler to push `agent_event` type `hitl_request` frames that the UI can subscribe to (mirrors existing plan updates).
- Ensure resume path replays persisted `hitlState.responses` into LLM prompts (inject in `buildPayloadForCapability`).

### 4.2 Nitro API Layer
- `pending.get.ts`: list awaiting runs with joined request metadata for dashboards.
- `resume.post.ts`: append operator responses, transition run to `running`, append audit log in `runnerMetadata.auditLog`.
- `remove.post.ts`: mark request denied, set run status `cancelled`, log operator action.
- All handlers must assert feature flag + bearer auth, return 4xx for stale/mismatched runs to avoid silent corruption.

### 4.3 Front-End Integration
- Augment `AgentResultsPopup.vue` with a dedicated HITL panel component (`src/components/hitl/HitlPanel.vue`) fed by a Pinia store (`src/stores/hitl.ts`).
  - Store tracks `pendingRequests`, `selectedRequest`, `responses`, derived `awaitingRunId`.
  - Store listens to SSE frames of type `hitl_request`, `hitl_update`, `hitl_resolved` and fetches `/api/hitl/pending` as fallback on reconnect.
  - Panel presents request metadata (origin agent badge, timestamp, question/options) and exposes actions: Answer (resume) and Cancel (remove).
- Use Vuetify dialogs consistent with existing popup styling; ensure responsive layout for smaller viewports.

### 4.4 Persistence & Data Model
- `orchestrator_runs`
  - `pending_request_id` and `hitl_state_json` remain source of truth for orchestrator status.
  - Add B-tree index on (`status`, `pending_request_id`) via migration to accelerate `listAwaitingHitl`.
- `hitl_requests`
  - Entries inserted via repository with consistent timestamps; include `brief_id`, `thread_id` for reporting.
  - Add index on `run_id` + `status` to support dashboards.
- `hitl_responses`
  - Append-only audit trail; `request_id` fk cascades on request deletion.

## 5. Key Data Flows
### 5.1 Specialist raises HITL request
1. Specialist agent inspects context, decides to ask operator.
2. Within `withHitlContext`, agent calls `HitlService.raiseRequest` with payload (question/options/urgency).
3. Service enforces per-run limit, persists request via `DatabaseHitlRepository.create`, updates `hitl_state_json`, sets run status `awaiting_hitl`.
4. Orchestrator emits SSE frame `{ type: 'hitl_request', data: { request, runId } }` and marks loop idle.
5. UI receives event → store updates panel; Nitro `/api/hitl/pending` shows same run.

### 5.2 Operator responds (resume)
1. Operator enters answer in HITL panel.
2. UI POSTs `/api/hitl/resume` with `runId`, `requestId`, `responses[]`, `operator` metadata, optional note.
3. Handler validates payload, loads snapshot from `OrchestratorPersistence`, invokes `HitlService.applyResponses` to append to `hitl_responses`.
4. Persistence refresh writes `pending_request_id=null`, status `running`, extends `runnerMetadata.auditLog`.
5. Orchestrator’s watchdog detects cleared pending request on next tick (or via resume webhook) and restarts step loop injecting fresh responses into LLM prompts.
6. UI receives SSE `hitl_resolved` + subsequent plan updates.

### 5.3 Operator cancels (remove)
1. Operator chooses “Cancel request” (e.g., duplicate or invalid).
2. UI POSTs `/api/hitl/remove` with `runId`, optional `requestId`, reason, operator metadata.
3. Handler marks request denied, clears `pending_request_id`, sets run status `cancelled`, appends audit log.
4. Orchestrator stops loop; UI surfaces cancellation state; analytics receives `hitl_cancel_api` event.

### 5.4 Restart recovery
1. On orchestrator boot, `OrchestratorPersistence` loads all runs with `status=awaiting_hitl`.
2. Pending requests are replayed into in-memory cache; `listAwaitingHitl` still surfaces them.
3. When Nitro/UI resumes a run, same flow as 5.2 ensures continuity without duplicate requests.

## 6. API Surface
- `GET /api/hitl/pending`
  - Response: `{ ok: true, runs: [{ runId, threadId, briefId, pendingRequestId, status, updatedAt, executionContext, pendingRequest }] }`
- `POST /api/hitl/resume`
  - Body: `{ runId | threadId, requestId, responses: HitlResponseInput[], operator?, note? }`
  - Response: `{ ok: true, runId, status, pendingRequestId, requests, responses }`
- `POST /api/hitl/remove`
  - Body: `{ runId | threadId, requestId?, reason, operator?, note? }`
  - Response: `{ ok: true, runId, status: 'cancelled', requests, responses }`
- Ensure consistent error semantics: 401 (auth), 404 (run/request mismatch), 409 (stale state), 422 (validation).

## 7. Front-End State & UX Contract
- **Store**: `src/stores/hitl.ts` exposes state, actions, computed properties (`isAwaiting`, `activeRequest`, `isBusy`). Provides `connect(runId, correlationId)` to bind SSE stream, `submitResponse`, `cancelRequest`, `reloadPending`.
- **Components**:
  - `HitlPanel.vue`: lists requests, displays detail view with question, options (rendered as buttons). Shows agent origin icon + timestamp.
  - `HitlResponseForm.vue`: handles freeform text, approval toggles, option selection.
- **SSE Handling**: Extend `src/lib/agent-sse.ts` to route new event types to listeners. On websocket/SSE disconnect, fetch `/api/hitl/pending` to resync.
- **Accessibility**: Provide keyboard navigation and ARIA roles for panel; highlight urgent requests.
- **Error handling**: surface toast notifications via existing UI store when resume/remove fails.

## 8. Configuration & Feature Flagging
- Env vars in Nitro + agents server:
  - `ENABLE_HITL=true` to enable UI/API routes.
  - `HITL_MAX_REQUESTS` (default `3`) enforced inside `HitlService`.
  - `HITL_REQUEST_TTL` (optional future) to auto-expire stale prompts.
- UI hides HITL panel when flag disabled or no pending request present.
- Add shared config helper in `packages/shared/src/config.ts` consumed by Nitro + SPA via Vite env injection.

## 9. Observability & Telemetry
- Agents server logs (`getLogger().info`) already emit `hitl_request_created`, `hitl_request_denied`, `hitl_resume_api`, `hitl_cancel_api`. Ensure log fields include `runId`, `requestId`, `originAgent`, `operator.id`.
- Add metrics counters (e.g., StatsD) in `packages/agents-server/src/services/logger.ts` when available: `hitl.requests`, `hitl.responses`, `hitl.denied`.
- UI instrumentation: track operator actions via existing analytics hook (if available) to monitor response times.
- Alerting: dashboard on count of pending HITL requests older than SLA (e.g., 30 min) using `updatedAt` timestamps.
- Post-MVP checkpoint: schedule a weekly review of `hitl_pending_total`, breach count for 10-minute pending requests, resume/remove latency, and operator response times; log findings in the runbook and adjust thresholds before expanding beyond dev.

## 10. Security & Compliance
- Restrict Nitro HITL routes to internal operators via API bearer auth (`requireApiAuth`).
- Validate operator identity in payload and persist to `runnerMetadata.auditLog` for traceability.
- Store freeform responses in `hitl_responses.freeform_text`; ensure PII is handled per policy (mask in logs).
- UI should prevent accidental disclosure by only exposing HITL panel to authenticated internal users (same gating as create-post popup).

## 11. Rollout Strategy
1. **Dry run in staging** with feature flag on; validate SSE, persistence, resume/remove flows using runbook.
2. **Shadow mode**: enable orchestrator HITL raising but keep UI hidden; verify pending runs via API + telemetry.
3. **Internal beta**: enable UI for a small operator group; monitor metrics.
4. **General availability**: expand flag, add monitoring alerts.
5. **Fallback**: disable `ENABLE_HITL` to revert UI/APIs while keeping additive schema intact.

## 12. Risks & Mitigations
- **State divergence between orchestrator cache and DB**: Mitigate by making `HitlRepository.setRunState` the single writer and by integration tests covering resume/remove (Vitest + Drizzle test db).
- **UI drift from SSE contract**: Document event schema in `src/lib/agent-sse.ts` and add contract tests.
- **Operator latency leading to stale runs**: Introduce TTL warnings and optional auto-deny logic in future iteration.
- **Concurrency**: guard resume/remove with DB transactions (Drizzle) and status checks to avoid double-processing.

## 13. Decisions on Deferred Scope
- HITL history beyond the create-post popup is out of scope for this release.
- Operators will not be able to edit HITL request payloads before responding.
- Multi-operator collaboration (multiple responders per prompt) is not required.
- Surfacing HITL audit data to downstream analytics/reporting is deferred.
