# Epic FLEX-CAP-PC-1 — Capability Post-Condition Enforcement - Brownfield Enhancement

## Epic Goal
Instrument every flex capability with machine-verifiable post conditions so the orchestrator can automatically detect missing or low-quality outputs, trigger replans or HITL escalations, and expose granular status to operators without destabilizing existing runs.

## Epic Description

**Existing System Context:**
- Current relevant functionality: The flex orchestrator already normalizes TaskEnvelopes, streams `FlexEvent` lifecycles, and validates outputs against caller schemas and facet-derived capability contracts (docs/architecture/flex-agents-server/{5-core-concepts.md,7-execution-flow.md}). Post-run `goal_condition` arrays exist but are only evaluated at the very end of a run, making per-capability success criteria implicit.
- Technology stack: TypeScript services spanning Nitro (`server/api`), the dedicated `packages/flex-agents-server` runtime, shared contracts in `@awesomeposter/shared`, Vue 3 + Vite operator UI (Flex sandbox, plan inspector), and Drizzle/Postgres persistence.
- Integration points: `CapabilityRegistry` self-registration (packages/flex-agents-server/src/services/flex-capability-registry.ts), `GoalConditionEvaluator`, SSE telemetry consumers in `src/components/FlexSandboxPlanInspector.vue`, and the marketing capability catalog in `packages/shared/src/flex/marketing-catalog.ts`.

**Enhancement Details:**
- Introduce an optional `postConditions: FacetCondition[]` field to capability registrations/records so each capability can advertise the predicates that must hold true when it finishes. Shared schemas (`packages/shared/src/flex/types.ts`) and the registry API accept and persist the structured DSL payloads alongside existing facet contracts, compiling DSL → canonical JSON-Logic + metadata the same way TaskEnvelope `goal_condition` arrays do today.
- Persist the compiled post-condition metadata (referenced facets, JSON-pointer path, canonical DSL) in `flex_capabilities` and bubble it through `CapabilityRegistry.listActive/getCapabilityById`, plan graph nodes, and SSE payloads so planners, execution, and UI consumers stay in sync.
- Expand the capability summary emitted to planners so the `capabilityProvenance` table lists the facets each post condition guards, enabling the prompt to describe downstream expectations (for example, “This capability’s post conditions validate `post_copy` / `/value[0].status` equals `approved` before handing off to QA”). Update planner prompts and validation hints so LLM plans understand how satisfied predicates unblock dependent nodes.
- Extend the execution path so `FlexExecutionEngine` evaluates post conditions before a node is marked complete: failures block the final `node_complete` frame, re-dispatch the capability (or escalate to HITL) according to configurable runtime policy, and only emit completion once every predicate passes. Results are stored with the node output snapshot for audit/replay.
- Add runtime policy hooks plus defaults (for example `FLEX_CAPABILITY_POST_CONDITION_MAX_RETRIES` and per-capability overrides) so teams can specify how many automatic retries occur, when to escalate to HITL, and when to fail fast after unmet predicates.
- Surface post-condition status in operator tooling: Flex Sandbox lists them under each node, plan inspectors highlight unmet predicates, and telemetry/logging produce `flex.capability_condition_*` metrics/alerts to track regressions.

**Success Criteria:**
- Capability metadata, registry storage, and SSE payloads consistently include optional post-condition arrays without breaking legacy registrations.
- Runtime execution evaluates and records per-capability condition results before signaling node completion, honoring configured retry limits and escalation policies while keeping happy-path latency under 100 ms.
- Operators and debugging tools can see pass/fail/error states for every declared capability condition, with actionable telemetry and runbook guidance when failures spike.

## Stories
1. **Story 1 – Capability Metadata & Persistence:** Extend `@awesomeposter/shared` capability types, registry validation, and `flex_capabilities` schema to accept optional `postConditions` arrays, reusing the shared `FacetCondition` contract, compiling DSL inputs to canonical JSON-Logic/metadata at registration time, and ensuring auto-registration rejects malformed DSL/path combos. Document schema updates in `docs/architecture/flex-agents-server/11-capability-registry-agent-contracts.md`, including how registry summaries surface the facets guarded by each post condition.
2. **Story 2 – Planner, Runtime Evaluation & Policies:** Propagate post-condition metadata into plan nodes, evaluate predicates via `GoalConditionEvaluator` before emitting `node_complete`, implement runtime policy controls for retry counts and escalation, enrich planner prompts/validation hints with the post-condition facet coverage, and persist per-node results while streaming them on `node_complete`/`plan_updated`.
3. **Story 3 – Tooling & Observability:** Update Flex Sandbox/plan inspector UI to visualize post-condition status, add telemetry/log counters (`flex.capability_condition_failed`, `flex.capability_condition_error`), ship rollout/runbook guidance, and expose condition summaries in debug logs for fast triage.
4. **Story 4 – Marketing Catalog Adoption:** Update the curated marketing capabilities (`copywriter.SocialpostDrafting`, `designer.VisualDesign`, `strategist.SocialPosting`) in `packages/shared/src/flex/marketing-catalog.ts` so each publishes well-defined post conditions (DSL + compiled JSON-Logic) aligned with their output facets, add regression tests covering registration payloads, and document the new predicates in `docs/architecture/flex-agents-server/511-reference-capability-registry.md`.

## Compatibility Requirements
- [x] Existing public APIs remain unchanged; capability registrations gain an additive `postConditions` field that defaults to `[]` so current agents keep functioning.
- [x] Database schema changes (new JSONB column on `flex_capabilities` plus node-output persistence) are additive and deployed via forward-only migrations.
- [x] UI changes follow existing Vuetify/Flex UI patterns and reuse the current plan inspector components for new indicators.
- [x] Performance impact is minimal: post-condition evaluation reuses the shared evaluator, runs in-process, and can be staged via runtime policy configuration without redeploying code.

## Risk Mitigation
- **Primary Risk:** Overly aggressive or malformed post conditions could halt runs or spam operators with false positives, eroding trust in the planner.
- **Mitigation:** Provide catalog linting + sandbox previews before conditions go live, start new environments in monitor-only mode, and fall back to warnings when the evaluator reports errors.
- **Operational Triggers:** Alert if `flex.capability_condition_failed` exceeds 5% of total node completions over 15 minutes or if evaluator errors spike above 1%—roll back enforcement and inspect offending capability records.
- **Rollback Plan:** Switch enforcement back to monitor-only mode (or temporarily remove post-condition metadata from affected capabilities) so nodes skip evaluation; persisted metadata remains for future re-enable without requiring another migration.

## Definition of Done
- [ ] All three stories delivered with passing acceptance criteria and reviewed documentation updates.
- [ ] Capability registry endpoints, planner, and execution engine pass regression/unit tests with and without post conditions.
- [ ] Telemetry dashboards and alerts show the new metrics in staging with runbook links.
- [ ] Operator UI (Flex Sandbox/plan inspector) clearly communicates condition state without breaking existing layouts.
- [ ] Monitor/enforce rollback procedures tested in a non-prod environment.

## Validation Checklist

**Scope Validation:**
- [x] Epic can be satisfied in three tightly scoped stories (schema/persistence, runtime, tooling).
- [x] Enhancement follows existing flex planner/runtime patterns; no net-new platform required.
- [x] Integration complexity stays bounded to registry, planner, execution engine, and UI surfaces already owned by the team.
- [x] Work fits brownfield constraints and keeps the technology stack unchanged.

**Risk Assessment:**
- [x] Runtime risk is mitigated via additive schemas, monitor-first rollouts, and staged enablement plans.
- [x] Rollback is feasible (disable enforcement, keep metadata for future tuning).
- [x] Testing plan covers shared types, registry validation, evaluator logic, and UI indicators.
- [x] Team has the required ownership across shared contracts, agents server, Nitro APIs, and Vue UI.

**Completeness Check:**
- [x] Epic goal is measurable (every capability declares/executes post conditions with operator visibility).
- [x] Stories are sequenced logically (schema before runtime before UI/telemetry).
- [x] Success criteria align with telemetry + UI validation steps.
- [x] Dependencies called out (shared contracts, registry persistence, UI components) so downstream work begins unblocked.

---

**Story Manager Handoff:**

"Please develop detailed user stories for Epic FLEX-CAP-PC-1 — Capability Post-Condition Enforcement.

Key considerations:
- Enhancement spans `@awesomeposter/shared` capability contracts, the flex capability registry/service, `FlexExecutionEngine`, and Flex Sandbox/plan inspector Vue components.
- Integration points: `/api/v1/flex/capabilities/register`, registry persistence in Postgres via Drizzle, `FlexEvent` SSE payloads, telemetry counters, and the Condition DSL helper shared across Nitro + agents server.
- Follow existing patterns in `packages/flex-agents-server`, `server/api/flex/*`, `packages/shared/src/flex/*`, and `src/components/FlexSandbox*`.
- Critical compatibility requirements: additive migrations only, policy-driven runtime enforcement (monitor-first enablement), UI indicators that match current Vuetify styling, and no regressions in runs that omit post conditions.
- Each story must include validation that legacy capabilities continue to register/execute normally and that telemetry/operators can distinguish between failed predicates vs evaluator errors.

The epic should maintain system integrity while giving planners and operators deterministic proof that every capability satisfied its declared post conditions."
