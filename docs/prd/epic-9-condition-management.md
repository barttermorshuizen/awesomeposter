# Epic 9 — User-Friendly Policy Condition Management - Brownfield Enhancement

## Epic Goal
Deliver a human-friendly policy condition authoring experience so operators can safely edit runtime triggers (e.g. QA score thresholds) without touching raw JSON-Logic, while preserving full compatibility with the existing orchestrator policy engine.

## Epic Description

**Existing System Context:**
- Current relevant functionality: Flex orchestration policies embed JSON-Logic conditions under `TaskEnvelope.policies.runtime[].trigger.condition`, edited today in raw JSON inside the admin/Sandbox editors.
- Technology stack: Vue 3 + Pinia management UI (Flex Sandbox, policy editors), Nitro API server, shared TypeScript packages, Agents Server executing JSON-Logic triggers via Node.
- Integration points: `src/views/FlexSandboxView.vue` (policy editing), shared policy types in `@awesomeposter/shared`, persistence APIs under `server/api/flex/*`, and orchestrator evaluation utilities in `packages/agents-server`.

**Enhancement Details:**
- What's being added/changed: Introduce a lightweight expression DSL (`qaFindings.overallScore < 0.6 && ...`) with autocomplete, validation, and round-trip conversion to/from JSON-Logic.
- How it integrates: A shared parsing/transpile module converts the DSL to JSON-Logic for storage; the management UI surfaces an expression editor with variable/help metadata driven from a central registry; the backend validates expressions before persisting policies.
- Success criteria: Product/dev teams can author conditions via the new editor, errors are surfaced before save, existing policies continue to execute unchanged, and exports still emit canonical JSON-Logic.

## Stories
1. **Story 9.1 Pilot Expression Playground:** Ship an isolated Vue playground (local-only route) that offers autocomplete over a fake variable catalog, captures DSL strings, and shows the generated JSON-Logic in real time using mocked data. Collect pilot feedback hooks (copy/export buttons, logging) without touching production policy flows.
2. **Story 9.2 Shared DSL Parser & Validation:** Implement the real variable registry, shared parser/transpiler package, and unit tests that guarantee parity between DSL expressions and JSON-Logic output. Expose server-side validation utilities so future integrations can reject invalid inputs.
3. **Story 9.3 Flex Sandbox Integration:** Replace the existing JSON editor in Flex Sandbox policy forms with the DSL editor, wire up the shared parser on both client and Nitro API, ensure round-trip persistence, and feature-gate rollout behind an admin toggle. Provide migration/backfill tooling for existing policies.

## Compatibility Requirements
- [x] Orchestrator policy JSON schema remains unchanged; DSL metadata stored additively.
- [x] Backend APIs remain backward compatible for existing clients (DSL optional).
- [x] UI honours current Vue/Vuetify patterns and feature gating.
- [x] Performance impact is minimal (parsing happens client-side with lightweight server validation).

## Risk Mitigation
- **Primary Risk:** Incorrect parser/transpile logic could generate JSON-Logic that misfires, causing false positives/negatives in automation.
- **Mitigation:** Share a single parser module across client/server, add golden JSON fixture tests, and provide a policy preview harness that evaluates expressions against canned envelopes before deployment.
- **Rollback Plan:** Retain toggles to disable the DSL editor and fall back to raw JSON editing while keeping generated JSON-Logic unchanged.

## Definition of Done
- [ ] All stories delivered with acceptance criteria met.
- [ ] Existing policies render and save without regression (DSL optional).
- [ ] Shared parser package published and consumed by UI + server.
- [ ] Preview harness validates sample payloads and flags failures.
- [ ] Documentation updated (policy authoring guide, variable catalog reference).
- [ ] No regression in orchestrator execution or policy evaluation telemetry.

## Validation Checklist

**Scope Validation:**
- [x] Epic fits within 3 focused stories and leverages existing architecture.
- [x] Enhancement follows established Vue/Nitro/Agents patterns without new components.
- [x] Integration complexity limited to shared TypeScript modules and UI forms.
- [x] Architectural documentation remains valid (no new services required).

**Risk Assessment:**
- [x] Risk to existing system is low with additive DSL metadata and feature gating.
- [x] Rollback plan (disable DSL UI + reuse JSON-Logic) is feasible.
- [x] Testing approach covers parser correctness and runtime evaluation parity.
- [x] Team owns impacted surfaces (shared packages, Nitro, Vue UI).

**Completeness Check:**
- [x] Epic goal ties directly to operator usability and safety.
- [x] Stories are sequenced for progressive delivery (core parser → UI → validation).
- [x] Success criteria map to measurable outcomes (editor adoption, validation coverage).
- [x] Dependencies (parser module, agent server validation hooks) identified.

## Story Manager Handoff
"Please develop detailed user stories for Epic 9 — User-Friendly Policy Condition Management.

Key considerations:
- Enhancement touches `@awesomeposter/shared` policy types, Nitro policy persistence endpoints, and Vue management surfaces (Flex Sandbox, admin policy forms).
- Integration points: shared parser module consumed by both client (`src/views/FlexSandboxView.vue`, `src/components/FlexCreatePostDialog.vue`) and server validation utilities under `server/api/flex`.
- Follow existing patterns for shared package publishing, feature flags, and Pinia state updates.
- Critical compatibility requirements: JSON-Logic payloads remain the source of truth, DSL metadata optional, editor respects existing Vue/Vuetify UX conventions.
- Each story must verify that existing policies can still be edited/saved without DSL usage and that generated JSON-Logic round-trips produce identical runtime behavior.

This epic should maintain system integrity while enabling safer, more approachable condition authoring for policy operators."
