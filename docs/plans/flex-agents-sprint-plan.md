# Flex Agents Server Sprint Plan

## Sprint 1 Focus (2 Weeks)

### Objectives
- Establish shared flex runtime contracts in `@awesomeposter/shared`.
- Scaffold `packages/flex-agents-server` with capability registry endpoint and additive database schema.
- Deliver baseline flex run endpoint skeleton capable of accepting envelopes and streaming mock planner events behind a feature flag.

### Planned Stories
- **Shared Contracts**: 8.1 Flex Shared Contract Foundations
- **Server Scaffold & Registry**: 8.2 Flex Agents Server Scaffold & Capability Registry
- **Planner Skeleton (Phase 1)**: 8.3 Flex Run Endpoint & Planner Skeleton — deliver envelope validation, run persistence, stub plan graph, and SSE streaming with mocked capability execution.

### Sequencing & Owners
1. Shared contracts (8.1) — Platform/Shared owner; unblock downstream compilation.
2. Clone flex server & capability registry (8.2) — Platform/backend owner; coordinate DB migration review with backend lead.
3. Flex run endpoint skeleton (subset of 8.3) — Platform orchestrator owner; integrate with registry stubs and shared contracts.
4. Update root scripts & feature flags (`USE_FLEX_AGENTS_POPUP`) — DevOps/platform owner once server scaffold compiles.

### Capacity Assumptions
- ~4 engineer-weeks (1 platform, 1 backend, 1 shared types/infra at 1.3w each).
- Reserve 0.5 engineer-week for integration tests and documentation after scaffold lands.

### Quality & Readiness Work
- Run `npm --prefix packages/shared run build` and targeted unit tests after 8.1 to catch schema issues.
- Smoke-test flex server dev command (`npm run dev:flex`) and ensure `npm run dev:all` spawns all services.
- Create preliminary planner happy-path test (mock capabilities) to validate SSE flow before real agents plug in.
- Document capability registration usage in `docs/architecture/flex-agents-server.md`.

### Risks & Mitigations
- **Clone drift from legacy server**: keep shared modules in `@awesomeposter/shared`; add diff check before merge.
- **Registry persistence conflicts**: coordinate migration IDs with DB team; dry-run on staging DB.
- **Planner skeleton scope creep**: limit Sprint 1 to mocked capabilities; real agent execution deferred to Sprint 2.

## Sprint 2 Focus (2 Weeks)

### Objectives
- Complete flex run execution path with real capability handoffs, Ajv validation, and HITL resume integration.
- Persist run outputs and plan snapshots; surface resume/debug endpoints.
- Ensure flex telemetry/logging reaches parity with legacy orchestrator.

### Planned Stories
- **Planner Execution (Phase 2)**: Remaining work on 8.3 Flex Run Endpoint & Planner Skeleton (real capability dispatch, HITL resume wiring, Ajv validation).
- **Persistence**: 8.4 Flex Run Output & Snapshot Persistence.
- **Interfaces**: 8.5 Flex Run Resume & Debug Interfaces.
- **Telemetry**: 8.6 Flex Telemetry & Logging Parity.

### Sequencing & Owners
1. Finish 8.3 core execution (capability dispatch, Ajv validation, HITL flow) — Platform orchestrator owner.
2. Implement persistence tables and engine writes (8.4) — Backend owner; partner with platform owner for engine hooks.
3. Resume/debug endpoints (8.5) — Backend owner once persistence is available; QA run regression on HITL UI.
4. Telemetry/logging parity (8.6) — Platform/SRE owner after execution paths stabilized.
5. Update documentation & runbooks with new endpoints/metrics — PM + platform owner.

### Capacity Assumptions
- ~4.5 engineer-weeks (platform 2.0w, backend 1.5w, SRE/observability 1.0w) + 0.5 QA week for integration testing.
- Hold 0.5 engineer-week buffer for HITL edge-case fixes uncovered during testing.

### Quality & Readiness Work
- Integration tests covering happy path, validation failure, HITL pause/resume, and resume endpoint error cases.
- Ajv schema compilation caching profiled under load; include regression tests to prevent performance regressions.
- Logging snapshot tests verifying field presence; update monitoring dashboards with `flex.*` metrics.
- Run staging environment smoke of flex popup behind env flag; ensure legacy flows untouched.

### Risks & Mitigations
- **HITL resume race conditions**: rely on plan snapshots, add locking around resume; QA executes concurrency tests.
- **Ajv validation performance**: cache schemas per run, measure with synthetic payloads before deploy.
- **Telemetry double counting**: namespace metrics (`flex.`) and coordinate with observability to filter new streams.

## Sprint 3 Outlook

### Objectives
- Finalize capability inventory and automated registration for all specialist agents.
- Harden resilience (retry policies, failure handling) and prepare for limited pilot rollout.
- Address feedback from Sprint 2 testing and align with operator UX readiness.

### Candidate Stories
- 8.7 Flex Capability Inventory & Registration Coverage.
- Follow-up resilience tasks (e.g., dynamic policy conflict handling, planner heuristics refinements).
- Operator enablement tasks: finalizing feature flag rollout SOP, UI polish for flex popup.

### Dependencies & Considerations
- Capability inventory (8.7) depends on registry endpoint (8.2) and execution stability (8.3).
- Planner refinements rely on telemetry insights from Sprint 2.
- Pilot readiness requires PM coordination for training material updates.

### Risks & Mitigations
- **Inventory drift**: establish review checklist; consider automated validation script.
- **Pilot readiness delays**: schedule mid-sprint checkpoint with product/ops to confirm launch criteria.
- **Policy conflict handling backlog**: if discovered during Sprint 2 QA, prioritize as Sprint 3 item before pilot.

### Quality Focus
- Complete acceptance checklist for all 8.x stories; run regression suite including legacy orchestrator.
- Capture learnings in `docs/architecture/flex-agents-server.md` and sprint retrospective notes for future scaling.
