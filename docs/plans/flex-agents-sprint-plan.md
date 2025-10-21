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
- Stand up the shared facet catalog/contract compiler and migrate capability metadata to facet arrays so planner/execution share deterministic contracts (Stories 8.12, 8.13).
- Enable dynamic plan assembly from facet-aware registry metadata and wire the hybrid planner ↔ orchestrator handshake (Stories 8.8, 8.14).
- Land persistence and telemetry foundations needed for policy-driven replanning (Stories 8.4, 8.6) ahead of policy enforcement (Story 8.9).
- Maintain readiness for Story 8.5 resume/debug work once persistence versioning is available and planner lifecycle events are streaming.

### Completed This Sprint
- **8.10 Flex Planner Phase 2** (extension of 8.3) — dynamic execution path now exercises live capability hooks prepared in Sprint 1.

### Planned Stories
- **Facet Catalog & Contract Compiler**: 8.12 Flex Facet Schema Library & Contract Compiler.
- **Capability Metadata Migration**: 8.13 Flex Capability Metadata Facet Migration.
- **Dynamic Plan Assembly**: 8.8 Flex Dynamic Plan Assembly (consuming 8.12/8.13 outputs).
- **Hybrid Planner Loop Enablement**: 8.14 LLM Planner & Orchestrator Hybrid Loop.
- **Persistence**: 8.4 Flex Run Output & Snapshot Persistence (immediately after 8.8/8.14).
- **Interfaces**: 8.5 Flex Run Resume & Debug Interfaces (follows once 8.4 delivers plan/version storage).
- **Telemetry**: 8.6 Flex Telemetry & Logging Parity.
- **Policy Schema Foundation**: 8.9 Flex Task Policy Schema Foundation (after persistence + telemetry; blocks 8.23/8.25; 8.24 under refinement).

### Sequencing & Owners
1. Facet catalog & contract compiler (8.12) — Shared types/platform owner; pairs with planner lead for API design.
2. Capability metadata facet migration (8.13) — Platform/backend owner; coordinates with documentation lead to keep inventory in sync.
3. Dynamic plan assembly (8.8) — Planner/platform owner; consumes facet compiler outputs and updated capability metadata.
4. Hybrid planner loop enablement (8.14) — Planner/platform owner; integrates LLM planner handshake and SSE lifecycle events.
5. Persistence foundations (8.4) — Backend owner; collaborates with planner owner for plan version/snapshot hooks.
6. Resume/debug interfaces (8.5) — Backend owner once 8.4 persists plan versions and outputs.
7. Telemetry/logging parity (8.6) — Platform/SRE owner after plan versioning is available.
8. Policy schema foundation (8.9) — Planner/platform owner once persistence and telemetry stories land; required before policy action/runtime follow-ons (8.23, 8.25).  
9. Follow-on policy action stories (8.23/8.25) — Defer until 8.9 completes; plan during sprint transition review. 8.24 remains in refinement.

### Capacity Assumptions
- ~5.5 engineer-weeks (platform/planner 2.7w, backend 1.8w, shared types 0.6w, SRE/observability 0.8w) + 0.5 QA week for integration/policy tests.
- Hold 0.5 engineer-week buffer for facet migration fallout or planner prompt tuning discovered during 8.14.

### Quality & Readiness Work
- Validate facet catalog + contract compiler via shared/unit tests and ensure capability registrations pull definitions from the catalog (8.12, 8.13).
- Re-run capability registry inventory validation after migration to ensure documentation and exports stay in sync (8.13).
- Capture planner assembly snapshots for multiple envelopes asserting facet arrays, compiled schemas, and plan versions (8.8, 8.14).
- Ensure persistence migrations and write paths pass integration tests with resume/replay harnesses (8.4) before enabling policy engine.
- Telemetry story to deliver log/metric snapshot tests plus dashboard update checklist (8.6) ahead of policy triggers.
- Policy engine tests simulate policy triggers across quality, cost, latency, and HITL scenarios (8.9) leveraging persisted plan versions and telemetry hooks.
- Smoke `npm run dev:flex` after each major milestone to ensure facet catalog, planner handshake, and persistence wiring work end-to-end.

### Risks & Mitigations
- **Facet catalog adoption delays dynamic planning**: deliver 8.12 early and block merge on planner tests consuming the shared compiler.
- **Capability metadata drift**: include docs sync and facet-validation scripts in 8.13; fail CI if mismatched facets are detected.
- **Dynamic plan gaps without persistence**: sequence 8.4 immediately after 8.14 to avoid rework; gate policy features behind flag until persistence lands.
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
- Policy action/runtime work (8.23 Flex Policy Action Execution, 8.25 Flex Planner Envelope-Driven Context) — all gated on 8.9 completion.
- 8.24 Flex Conditional Action Node — needs refinement to resolve overlap between planner-authored branching and existing runtime policies before scheduling (targeted for Sprint 3 once direction is confirmed).
- **New:** 8.27 Flex Runtime Node Selector Extension — depends on 8.26 and the policy runtime stories above; expands selector grammar once fallback execution is stable.
- Additional capability onboarding or automation stories (e.g., 8.11+ once prioritized).

### Dependencies & Considerations
- Capability inventory rounding (new agents) depends on registry endpoint (8.2) and execution stability (8.3/8.10).
- Dynamic planning (8.8) must be complete before resilience/policy follow-ups; telemetry insights from Sprint 2 inform Sprint 3 heuristics.
- Policy schema foundation (8.9) is a hard blocker for 8.23/8.24/8.25; do not start those stories until 8.9 is merged and documented.
- Resume/debug interfaces (8.5) and pilot readiness require persistence (8.4) to be hardened during Sprint 2.

### Risks & Mitigations
- **Inventory drift**: establish review checklist; consider automated validation script.
- **Pilot readiness delays**: schedule mid-sprint checkpoint with product/ops to confirm launch criteria.
- **Policy conflict handling backlog**: if discovered during Sprint 2 QA, prioritize as Sprint 3 item before pilot.

### Quality Focus
- Complete acceptance checklist for all 8.x stories; run regression suite including legacy orchestrator.
- Capture learnings in `docs/architecture/flex-agents-server.md` and sprint retrospective notes for future scaling.
