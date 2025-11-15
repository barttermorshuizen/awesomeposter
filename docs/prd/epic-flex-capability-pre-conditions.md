# Epic FLEX-CAP-PRE-1 — Capability Pre-Condition Guardrails - Brownfield Enhancement

## Epic Goal
Instrument every flex capability with machine-verifiable pre-conditions so the orchestrator can automatically guard node invocation, trigger replans by default (or runtime policy-controlled actions), and expose granular status to operators before work starts.

## Epic Description

**Existing System Context:**
- Current relevant functionality: The flex orchestrator normalizes TaskEnvelopes, builds plan graphs, and validates outputs against caller schemas and facet-derived capability contracts (docs/architecture/flex-agents-server/{5-core-concepts.md,7-execution-flow.md}). Dependencies today are implicit in planner edges; there is no first-class, declarative capability-level pre-condition gate before execution, so nodes can start with missing prerequisites and only fail downstream.
- Technology stack: TypeScript services spanning Nitro (`server/api`), the dedicated `packages/flex-agents-server` runtime, shared contracts in `@awesomeposter/shared`, Vue 3 + Vite operator UI (Flex Sandbox, plan inspector), and Drizzle/Postgres persistence.
- Integration points: `CapabilityRegistry` self-registration (packages/flex-agents-server/src/services/flex-capability-registry.ts), `GoalConditionEvaluator` / condition DSL helpers, plan graph construction, SSE telemetry consumers in `src/components/FlexSandboxPlanInspector.vue`, and the curated capability catalog in `packages/shared/src/flex/marketing-catalog.ts`.

**Enhancement Details:**
- Introduce an optional `preConditions: FacetCondition[]` field to capability registrations/records so each capability can declare predicates that must hold before invocation. Shared schemas (`packages/shared/src/flex/types.ts`) and the registry API accept and persist structured DSL payloads, compiling DSL → canonical JSON-Logic + metadata (referenced facets, JSON-pointer paths) alongside existing contracts.
- Persist compiled pre-condition metadata in `flex_capabilities`, expose it through `CapabilityRegistry.listActive/getCapabilityById`, and propagate it onto plan graph nodes and SSE payloads so planners, runtime, and UI consumers stay in sync without breaking legacy registrations.
- Enrich planner summaries/prompts so `capabilityProvenance` indicates the facets and paths each pre-condition guards, enabling the planner to order dependencies correctly and to request replans when unmet pre-conditions would block a node. Default behavior on unmet pre-conditions is to trigger a replan; runtime policies allow overrides (retry, skip, HITL escalation, fail-fast).
- Extend `FlexExecutionEngine` to evaluate pre-conditions before dispatching a node. Failures block invocation, emit structured status in run state + telemetry, and execute the configured policy action. Successful evaluations are recorded with the node snapshot for audit/replay.
- Surface pre-condition status in operator tooling: Flex Sandbox/plan inspector display pending/passed/failed states per node, SSE frames include pre-condition results, and telemetry/logging produce `flex.capability_pre_condition_*` metrics/alerts with runbook links.

**Success Criteria:**
- Capability metadata, registry storage, and plan nodes consistently include optional pre-condition arrays without breaking existing capability registrations or planner behavior.
- Runtime execution gates node dispatch on pre-conditions, defaulting to replans when unmet and honoring policy-controlled actions, while keeping added latency under 100 ms.
- Operators and debugging tools can see pass/fail/error states for every declared pre-condition before a capability runs, with actionable telemetry and rollout controls.

## Stories
1. **Story 1 – Capability Metadata & Persistence:** Extend `@awesomeposter/shared` capability types, registry validation, and `flex_capabilities` schema to accept optional `preConditions` arrays, reusing the shared `FacetCondition` contract, compiling DSL inputs to canonical JSON-Logic/metadata at registration time, and ensuring auto-registration rejects malformed DSL/path combos. Document schema updates in `docs/architecture/flex-agents-server/11-capability-registry-agent-contracts.md`, including how registry summaries surface the facets guarded by each pre-condition.
2. **Story 2 – Planner, Runtime Gating & Policies:** Propagate pre-condition metadata into plan nodes, evaluate predicates via the shared condition evaluator before dispatching capabilities, implement runtime policy controls for what happens when pre-conditions fail (default replan, optional retry/skip/HITL/fail-fast), enrich planner prompts/validation hints with pre-condition facet coverage, and persist per-node results while streaming them on `plan_updated`/`node_status` frames.
3. **Story 3 – Tooling, Telemetry & Pilot Adoption:** Update Flex Sandbox/plan inspector UI to visualize pre-condition state, add telemetry/log counters (`flex.capability_pre_condition_failed`, `flex.capability_pre_condition_error`, replan reasons), ship rollout/runbook guidance, and pilot the feature by adding well-defined pre-conditions to a small set of catalog capabilities with regression tests for registration payloads.
4. **Story 4 – Marketing Catalog Adoption:** Update curated marketing capabilities (`copywriter.SocialpostDrafting`, `designer.VisualDesign`, `strategist.SocialPosting`, etc.) in `packages/shared/src/flex/marketing-catalog.ts` to publish pre-conditions aligned to their facets, ensure registrations include compiled DSL + JSON-Logic payloads, add regression tests for registration envelopes, and document the new predicates in `docs/architecture/flex-agents-server/511-reference-capability-registry.md`.

## Compatibility Requirements
- [x] Existing public APIs remain unchanged; capability registrations gain an additive, optional `preConditions` field that defaults to `[]` so current agents keep functioning.
- [x] Database schema changes (new JSONB column on `flex_capabilities` plus node-state persistence) are additive and deployed via forward-only migrations.
- [x] UI changes follow existing Vuetify/Flex UI patterns and reuse the current plan inspector components for new indicators.
- [x] Performance impact is minimal: pre-condition evaluation reuses the shared evaluator, runs in-process, and can be staged via runtime policy configuration without redeploying code.

## Risk Mitigation
- **Primary Risk:** Overly strict or malformed pre-conditions could block nodes and force constant replans, causing churn or masking real failures.
- **Mitigation:** Provide catalog linting + sandbox previews before enforcement, and document policy toggles per capability to tune behavior; MVP posture is go-forward enforcement rather than staged monitor-only rollout.
- **Operational Triggers:** Alert if `flex.capability_pre_condition_failed` or replan counts exceed 5% of node dispatch attempts over 15 minutes, or if evaluator errors spike above 1%—investigate offending capability records and policy settings.
- **Rollback Plan:** Temporarily remove or relax pre-condition metadata/policy for affected capabilities if enforcement churns; persisted metadata remains for future re-enable without another migration.

## Definition of Done
- [ ] All four stories delivered with passing acceptance criteria and reviewed documentation updates.
- [ ] Capability registry endpoints, planner, and execution engine pass regression/unit tests with and without pre-conditions.
- [ ] Telemetry dashboards and alerts show the new metrics in staging with runbook links.
- [ ] Operator UI (Flex Sandbox/plan inspector) clearly communicates pre-condition state without breaking existing layouts.
- [ ] Monitor/enforce rollback procedures tested in a non-prod environment.

## Validation Checklist

**Scope Validation:**
- [x] Epic can be satisfied in four tightly scoped stories (schema/persistence, runtime/policies, UI/telemetry + pilot adoption, marketing catalog adoption).
- [x] Enhancement follows existing flex planner/runtime patterns; no net-new platform required.
- [x] Integration complexity stays bounded to registry, planner, execution engine, and UI surfaces already owned by the team.
- [x] Work fits brownfield constraints and keeps the technology stack unchanged.

**Risk Assessment:**
- [x] Runtime risk is mitigated via additive schemas, documented policy toggles, and clear alerting/rollback paths under go-forward enforcement.
- [x] Rollback is feasible (disable/relax pre-condition metadata or policy per capability, keep metadata for future tuning).
- [x] Testing plan covers shared types, registry validation, evaluator logic, planner ordering, and UI indicators.
- [x] Team has the required ownership across shared contracts, agents server, Nitro APIs, and Vue UI.

**Completeness Check:**
- [x] Epic goal is measurable (every capability can declare/execute pre-conditions with operator visibility).
- [x] Stories are sequenced logically (schema before runtime before UI/telemetry).
- [x] Success criteria align with telemetry + UI validation steps.
- [x] Dependencies called out (shared contracts, registry persistence, UI components, sample catalog capabilities) so downstream work begins unblocked.

---

**Story Manager Handoff:**

"Please develop detailed user stories for Epic FLEX-CAP-PRE-1 — Capability Pre-Condition Guardrails.

Key considerations:
- Enhancement spans `@awesomeposter/shared` capability contracts, the flex capability registry/service, planner graph construction, `FlexExecutionEngine`, and Flex Sandbox/plan inspector Vue components.
- Integration points: `/api/v1/flex/capabilities/register`, registry persistence in Postgres via Drizzle, `FlexEvent` SSE payloads, telemetry counters, and the Condition DSL helper shared across Nitro + agents server.
- Follow existing patterns in `packages/flex-agents-server`, `server/api/flex/*`, `packages/shared/src/flex/*`, and `src/components/FlexSandbox*`.
- Critical compatibility requirements: additive migrations only, policy-driven runtime enforcement with default replan behavior, UI indicators that match current Vuetify styling, and no regressions in runs that omit pre-conditions.
- Each story must include validation that legacy capabilities continue to register/execute normally, that planner ordering respects declared pre-conditions, and that operators/telemetry can distinguish between failed predicates vs evaluator errors or policy-driven replans.

This epic should maintain system integrity while giving planners and operators deterministic proof that every capability met its declared pre-conditions before execution."
