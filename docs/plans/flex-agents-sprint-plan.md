# Flex Agents Server Sprint Plan

## Sprint 1 Focus (Completed)

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

## Sprint 2 Focus (In Progress)

### Objectives
- Finalize capability inventory and ensure live registration data powers planner decisions (Story 8.7).
- Enable dynamic plan assembly from registry metadata so flex runs adapt beyond the stubbed happy path (Story 8.8).
- Land persistence and telemetry foundations needed for policy-driven replanning (Stories 8.4, 8.6) ahead of policy enforcement (Story 8.9).
- Maintain readiness for Story 8.5 resume/debug work once persistence versioning is available.

### Completed This Sprint
- **8.10 Flex Planner Phase 2** (extension of 8.3) — dynamic execution path now exercises live capability hooks prepared in Sprint 1.

### Planned Stories
- **Capability Inventory & Registration**: 8.7 Flex Capability Inventory & Registration Coverage.
- **Dynamic Plan Assembly**: 8.8 Flex Dynamic Plan Assembly.
- **Persistence**: 8.4 Flex Run Output & Snapshot Persistence (immediately after 8.8).
- **Telemetry**: 8.6 Flex Telemetry & Logging Parity.
- **Policy Engine**: 8.9 Flex Planner Signals & Policy Overrides (after persistence + telemetry).
- **Interfaces**: 8.5 Flex Run Resume & Debug Interfaces (follows once 8.4 delivers plan/version storage).

### Sequencing & Owners
1. Capability inventory + registration coverage (8.7) — Platform/shared owner; pairs with documentation lead.
2. Dynamic plan assembly (8.8) — Planner/platform owner; coordinates with shared contracts team.
3. Persistence foundations (8.4) — Backend owner; collaborates with planner owner for snapshot hooks.
4. Telemetry/logging parity (8.6) — Platform/SRE owner after persistence wiring is in-place.
5. Policy engine + signals (8.9) — Planner/platform owner once persistence and telemetry stories land.
6. Resume/debug interfaces (8.5) — Backend owner immediately after 8.4 delivers persisted plan versions.

### Capacity Assumptions
- ~4.5 engineer-weeks (platform/planner 2.2w, backend 1.5w, SRE/observability 0.8w) + 0.5 QA week for integration/policy tests.
- Hold 0.3 engineer-week buffer for registry inventory churn or scoring adjustments discovered during 8.8.

### Quality & Readiness Work
- Validate capability metadata via unit tests consuming registry payloads (8.7) and plan assembly snapshots for multiple envelopes (8.8).
- Ensure persistence migrations and write paths pass integration tests with resume/replay harnesses (8.4) before enabling policy engine.
- Telemetry story to deliver log/metric snapshot tests plus dashboard update checklist (8.6) ahead of policy triggers.
- Policy engine tests simulate policy triggers across quality, cost, latency, and HITL scenarios (8.9) leveraging persisted plan versions.
- Smoke `npm run dev:flex` after each major milestone to ensure registry, planner, and persistence wiring work end-to-end.

### Risks & Mitigations
- **Inventory drift delaying dynamic planning**: lock inventory doc updates into review checklist; include validation tests.
- **Dynamic plan gaps without persistence**: sequence 8.4 immediately after 8.8 to avoid rework; gate policy features behind flag until persistence lands.
- **Telemetry lagging policy engine**: require 8.6 completion before enabling 8.9 SSE policy events; add logging fallbacks if metrics ingestion misses deadline.
- **Policy loops once enabled**: enforce guardrails and monitoring during 8.9 delivery; coordinate with QA on scenario coverage.

## Sprint 3 Outlook

### Objectives
- Extend capability coverage to remaining specialist agents or new variants discovered during Sprint 2.
- Harden resilience (retry policies, failure handling) and prepare for limited pilot rollout.
- Address feedback from Sprint 2 testing, including policy tuning and operator UX readiness.

### Candidate Stories
- Follow-up resilience tasks (e.g., dynamic policy conflict handling, planner heuristics refinements).
- Operator enablement tasks: finalizing feature flag rollout SOP, UI polish for flex popup.
- Additional capability onboarding or automation stories (e.g., 8.11+ once prioritized).

### Dependencies & Considerations
- Capability inventory rounding (new agents) depends on registry endpoint (8.2) and execution stability (8.3/8.10).
- Dynamic planning (8.8) must be complete before resilience/policy follow-ups; telemetry insights from Sprint 2 inform Sprint 3 heuristics.
- Resume/debug interfaces (8.5) and pilot readiness require persistence (8.4) to be hardened during Sprint 2.

### Risks & Mitigations
- **Inventory drift**: establish review checklist; consider automated validation script.
- **Pilot readiness delays**: schedule mid-sprint checkpoint with product/ops to confirm launch criteria.
- **Policy conflict handling backlog**: if discovered during Sprint 2 QA, prioritize as Sprint 3 item before pilot.

### Quality Focus
- Complete acceptance checklist for all 8.x stories; run regression suite including legacy orchestrator.
- Capture learnings in `docs/architecture/flex-agents-server.md` and sprint retrospective notes for future scaling.
