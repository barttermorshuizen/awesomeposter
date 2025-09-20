# Human-in-the-Loop Approval Implementation Plan — Orchestrator-Initiated Checkpoints

Scope
- Enable optional human approval checkpoints during orchestrated runs without breaking automated flows.
- Orchestrator remains responsible for inserting, pausing on, and clearing approvals based on specialist advisories and policy.
- Surface approvals consistently in server telemetry, persistence, and UI.

Non-goals (Phase 1)
- Automated assignment/rotation of reviewers (manual selection only).
- External notification channels (email/Slack) — tracked separately.
- Multi-tenant policy editor UI (config lives in DB or env-config for now).
- Attachments upload from approval UI (reuse existing asset viewer only).

Architecture Reference
See [`docs/hitl-architecture.md`](./hitl-architecture.md) for detailed component design, SSE frames, and policy behavior.

Key integration points (existing code)
- Orchestrator engine and persistence: `packages/agents-server/src/services/orchestrator-engine.ts`.
- Shared run types: `packages/shared/src/agent-run.ts`.
- Agent runtime + registry: `packages/agents-server/src/services/agent-runtime.ts`, `packages/agents-server/src/services/agents-container.ts`.
- SSE route: `packages/agents-server/routes/api/v1/agent/run.stream.post.ts`.
- UI surfaces: `src/views/SandboxView.vue`, `src/components/AgentResultsPopup.vue`, `src/components/CreatePostPopup.vue`.
- Auth/session helpers: `server/middleware/auth.ts` (and related).

Milestones & Deliverables

M0 — Schema & Contracts (0.5 day)
- ✅ Completed (see `packages/shared/src/agent-run.ts` + tests)
- Update `packages/shared/src/agent-run.ts` with `ApprovalAdvisory` and `PendingApproval` types.
- Export types via `packages/shared/src/index.ts`.
- Add unit tests covering serialization/deserialization of new fields.

M1 — Specialist Advisory Support (1 day)
- ✅ Completed (2025-02-14). Advisory heuristics live in `packages/agents-server/src/services/approval-advisories.ts` with unit + integration coverage.
- Extend specialist agents to optionally populate `approvalAdvisory`:
  - Strategy: flag risky objectives or missing info when policy demands human input.
  - Content: mark drafts containing high-risk patterns (e.g., legal claims) using existing heuristics.
  - QA: convert failing acceptance criteria into `approvalAdvisory` instead of hard fail when policy allows.
- Add guardrails so advisories never block the specialist from returning control.

M2 — Orchestrator Policy Engine (1.5 days)
- ✅ Completed (2025-02-16).
- Implement approval policy evaluator in `orchestrator-engine.ts` that inspects `StepResult` and global policy.
- Introduce plan step type `approval.wait` and plan patch logic.
- Persist `pendingApprovals` to in-memory store prototype; add TODO for external store gating behind feature flag.
- Emit SSE `phase=approval` and `message` frames when waiting.
- Unit tests: verify plan patching, dedupe, resume behavior with mocked store.
- Implementation notes / TODOs:
  - ✅ Step results inject `approval.wait` checkpoints & persist to in-memory approval store behind `ENABLE_HITL_APPROVALS`.
  - ✅ Rejection decisions trigger deterministic replan with reviewer notes enqueued for Strategy/Content.
  - 🔜 Broaden integration coverage for resume after restart once durable store lands.

M3 — Persistence Adapter (1 day)
- ✅ Completed (2025-02-16).
- ✅ Create persistence abstraction `ApprovalStore` with methods `getPending`, `saveDecision`, `listByThread`.
- ✅ Back `ApprovalStore` with existing persistence layer (initially same in-memory store; later Postgres/Redis) under feature flag `ENABLE_HITL_APPROVALS`.
- ✅ Ensure run resume uses store to restore waiting state.
- ✅ Add Postgres-backed durable store behind `ENABLE_HITL_APPROVALS_DURABLE` with graceful fallback.

M4 — Approval API Surface (1 day)
- ✅ Completed (2025-02-16).
- Add Nitro route `POST /api/v1/orchestrator/approval` with validation and auth (reuse session middleware).
- Optional `GET /api/v1/orchestrator/approvals` for dashboard/polling.
- Emit SSE `approval_decision` frames after persisting decision.
- Integration tests hitting the new endpoint with mock store.

M5 — UI Enhancements (1.5 days)
- ✅ Completed (2025-02-18). `SandboxView.vue` renders the waiting banner, evidence list, and approval form via
  `ApprovalCheckpointBanner.vue`, including optimistic decision handling and history view.
- ✅ Completed (2025-02-18). `AgentResultsPopup.vue` mirrors pending and resolved approvals so reviewers see the
  checkpoint trail alongside the plan and timeline.
- ✅ Completed (2025-02-18). API helpers (`src/lib/agents-api.ts`) expose `listPendingApprovals` and
  `postApprovalDecision` with optimistic UI fallbacks.
- 🔜 Add an automated end-to-end/UI smoke test that exercises the approval banner and decision buttons (manual
  verification only so far).

M6 — Resume & Failure Paths (0.5 day)
- ✅ Completed (2025-02-18). Orchestrator resumes automatically after approval decisions and applies rejection
  behaviors (`replan` vs `finalize`) per `hitlPolicy`, emitting SSE updates for downstream clients.
- ✅ Completed (2025-02-18). Integration coverage in
  `packages/agents-server/__tests__/approval-advisory.integration.spec.ts` asserts replanning, forced finalize, and
  resume-from-snapshot flows.

M7 — Observability & Metrics (0.5 day)
- 🚧 Not started. Structured logs exist via SSE events, but dedicated metrics counters and dashboard updates remain
  TODO.

M8 — Hardening & Feature Flag Rollout (0.5 day)
- ✅ Completed (2025-02-18). Feature flags `ENABLE_HITL_APPROVALS` and `ENABLE_HITL_APPROVALS_DURABLE` gate the
  orchestrator policy and persistence adapters.
- 🔜 Update `docs/migration_notes.md` with approval rollout steps and schedule load testing before GA.

Acceptance Criteria
- Orchestrator emits `plan_update` and `phase=approval` when policy triggers, and stays idle until decision arrives.
- Approved runs resume automatically and finalize without regression.
- Rejected approvals result in deterministic replanning or failure consistent with policy settings.
- UI shows pending approvals with evidence, and reviewers can approve/reject via new API.
- SSE stream reflects waiting state and eventual decision for external consumers.

Testing Plan
1. **Unit Tests**
   - Approval policy function: advisories trigger checkpoints, dedupe logic works, policy overrides apply.
   - Shared type serialization for `ApprovalAdvisory` and `PendingApproval`.
2. **Integration Tests (agents-server)**
   - Simulated run with advisory triggers `approval.wait`, persists pending approval, resumes after API call.
   - Rejection path triggers replanning or final failure.
3. **UI Tests**
   - Component tests for Sandbox approval banner and action buttons.
   - End-to-end smoke verifying SSE waiting state surfaces in UI.
4. **Manual QA**
   - Verify feature flag toggles (off = no approval flow).
   - Resume runs after server restart while waiting for approval.

Risks & Mitigations
- **Race conditions between multiple reviewers** → enforce idempotent `decisionId` and last-write-wins policy with audit trail.
- **Deadlock if approval never arrives** → configurable SLA timer (`autoFailAt`) to finalize run with warning.
- **User confusion over approvals vs QA failures** → clear UI messaging and SSE notes referencing advisory source.
- **Persistence migration complexity** → start with in-memory store gated by feature flag; plan follow-up for durable store once behavior validated.
