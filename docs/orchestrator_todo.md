# Legacy Orchestrator TODO (Archived)

> **Legacy Notice**  
> The Flex marketing runtime (`FlexRunCoordinator`, capability registry, and TaskEnvelope policies) replaced the legacy orchestrator. This document is retained for historical traceability only. Active orchestration work now lives in:
> - `docs/flex-agentic-architecture201025.md`
> - `docs/architecture/flex-agents-server/11-capability-registry-agent-contracts.md`
> - `docs/stories/11.2.flex-marketing-capability-catalog.md`
>
> The checklist below is archived and should not be used to drive new work.

## Legacy checklist (for reference)

> Former backlog retained verbatim for auditability. Items that remain unchecked were superseded rather than completed.

### 1) Consolidate Data Models

- [ ] Consolidate orchestrator data models: move Plan/PlanStep into shared (done), define shared StepResult/RunReport (done), and integrate them across orchestrator/specialists (pending). Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [x] Decide and lock the final bundle schema in shared as { result, quality, acceptance-report } and update orchestrator emit sites to match. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [x] Update shared schema/types and consumers to the new bundle; fix tests and normalization. Touch: [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts), [normalize-app-result.ts](awesomeposter/src/lib/normalize-app-result.ts), [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [CreatePostPopup.vue](awesomeposter/src/components/CreatePostPopup.vue), [AgentResultsPopup.vue](awesomeposter/src/components/AgentResultsPopup.vue)

### 2) Orchestrator Engine Refactor

- [x] Make orchestrator code domain-agnostic: remove social-specific details and tool names from orchestrator; keep domain guidance in specialist prompts/payloads. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [strategy-manager.ts](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts), [content-generator.ts](awesomeposter/packages/agents-server/src/agents/content-generator.ts), [quality-assurance.ts](awesomeposter/packages/agents-server/src/agents/quality-assurance.ts)
- [x] Introduce a minimal Plan type and Registry abstraction; maintain and emit plan_update SSE frames when plan changes during a run. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)
- [x] LLM-driven planning loop: remove static plan seeding and phase-based gating; have the orchestrator/LLM propose the initial plan and emit plan_update patches as it revises the plan during the run. Implement plan patch merge/apply and plan-driven step progression. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts), [docs/orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md)
- [x] Refactor orchestrator into explicit plan → step → replan transitions while preserving RESUME_STORE writes and SSE emissions (note: resume read path still pending). Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)
- [x] Prompt changes for planning: instruct proposing an initial plan from Registry capabilities + constraints and emitting plan_update patches; remove the prescriptive “Plan → Generate → QA → Finalize”. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)
- [x] Stream‑driven plan_update ingestion: parse LLM outputs for structured plan_update patches, apply immediately, and emit SSE (delta gating pending elsewhere). Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [x] Add a lightweight persistence/resume mechanism (in-memory map keyed by threadId) to store plan and history; allow resume on subsequent calls. Touch: [run.stream.post.ts](awesomeposter/packages/agents-server/routes/api/v1/agent/run.stream.post.ts), [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)
- [x] Step execution reliability: add per-step timeouts and retry policy for specialist runs. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-runtime.ts](awesomeposter/packages/agents-server/src/services/agent-runtime.ts)
 - [x] Result integration: aggregate StepResult into a RunReport and persist alongside the plan for resumability. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [x] Remove orchestrator fallback synthesis of outputs; on empty/invalid final output, emit warning and finalize with explanation. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)

### 3) Registry & Capabilities

- [x] Capability-driven registry wiring: generate handoffs from an app-level capability Registry (not hardcoded roles). Support per-run allowlists/policy for specialist tools. Touch: [agents-container.ts](awesomeposter/packages/agents-server/src/services/agents-container.ts), [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [agent-runtime.ts](awesomeposter/packages/agents-server/src/services/agent-runtime.ts)
- [x] Review and tighten tool allowlists/policy enforced via specialists only; confirm Orchestrator has no tools configured. Touch: [agent-runtime.ts](awesomeposter/packages/agents-server/src/services/agent-runtime.ts), [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)

### 4) Specialist Agents

- [ ] Trim specialist agents to minimum tools and ensure each returns a structured StepResult; remove any replanning logic. Touch: [strategy-manager.ts](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts), [content-generator.ts](awesomeposter/packages/agents-server/src/agents/content-generator.ts), [quality-assurance.ts](awesomeposter/packages/agents-server/src/agents/quality-assurance.ts)

### 5) Event Streaming & Telemetry

- [x] Align SSE framing with the doc: emit phase transitions, gate delta to generation/qa only, and add plan_update frames with meaningful plan patches. Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)
- [x] Emit full RunReport prior to completion as a message frame (message: "run_report"). Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts)
- [ ] Generalize telemetry and guards: remove domain-specific flags and warnings; detect specialist involvement by capability/agent identity (not tool names) and use domain‑neutral terms (e.g., “generation specialist”, “artifacts”). Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [ ] Maintain optional approval hooks before continuing past checkpoints (no-op default). Touch: [orchestrator-engine.ts](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts), [SandboxView.vue](awesomeposter/src/views/SandboxView.vue)

### 6) UI & Server Integration

- [x] Continue exposing /api/v1/agent/run.stream and align clients to this entry point. Touch: [run.stream.post.ts](awesomeposter/packages/agents-server/routes/api/v1/agent/run.stream.post.ts)
- [x] Update UI to render plan progress and artifacts: consume plan_update frames, show phases, and display FinalBundle fields. Touch: [SandboxView.vue](awesomeposter/src/views/SandboxView.vue), [CreatePostPopup.vue](awesomeposter/src/components/CreatePostPopup.vue)

### 7) Testing & Hardening

- [x] Update existing integration tests to assert FinalBundle shape and phase emissions. Touch: [handoff-filtering.integration.spec.ts](awesomeposter/packages/agents-server/__tests__/handoff-filtering.integration.spec.ts)
 - [x] Add reliability test: simulate long-running specialist to assert timeout + retry behavior and metrics frames. Touch: [step-reliability.spec.ts](awesomeposter/packages/agents-server/__tests__/step-reliability.spec.ts)
 - [x] Add delta-gating test: deltas only during generation/qa. Touch: [delta-gating.spec.ts](awesomeposter/packages/agents-server/__tests__/delta-gating.spec.ts)
 - [x] Add resume test: threadId restores plan/history. Touch: [resume.spec.ts](awesomeposter/packages/agents-server/__tests__/resume.spec.ts)
- [ ] Add unit/integration tests: prompt sentinel presence in buildSystemPrompt, handoff filtering correctness, plan_update emission, final bundle schema validation, and warnings when content/QA involvement is missing. Touch: [prompt-filters.spec.ts](awesomeposter/packages/agents-server/__tests__/prompt-filters.spec.ts), [handoff-filtering.integration.spec.ts](awesomeposter/packages/agents-server/__tests__/handoff-filtering.integration.spec.ts)
- [ ] Add integration tests for a full orchestrated run using mock agents and extend telemetry tests for token/runtime budgets. Touch: [plan-run.integration.spec.ts](awesomeposter/packages/agents-server/__tests__/plan-run.integration.spec.ts), [telemetry.spec.ts](awesomeposter/packages/agents-server/__tests__/telemetry.spec.ts)

### 8) Docs & Deployment

- [ ] Write migration notes summarizing changes and how to resume existing threads or start fresh. Touch: [README.md](awesomeposter/README.md), [docs/orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md:1)
- [ ] Document required environment variables for Agents SDK, persistence, and feature flags. Touch: [README.md](awesomeposter/README.md), [docs/orchestrator-as-code.md](awesomeposter/docs/orchestrator-as-code.md)

## Key implementation references

- Orchestrator entrypoint and run engine: [runOrchestratorEngine](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts:157), wrapper [OrchestratorAgent](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:1)
- Prompt filtering utilities and sentinels: [prompt-filters.ts](awesomeposter/packages/agents-server/src/utils/prompt-filters.ts:1)
- SSE route: [run.stream.post.ts](awesomeposter/packages/agents-server/routes/api/v1/agent/run.stream.post.ts:1)

## Sync policy

- This file is authoritative for the orchestrator MVP TODO.
- The assistant will update this file and the task Reminders in lock‑step as items are completed.

## Acceptance

- Matches the SSE framing and bundle contract from [orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md:87).
- No orchestrator-authored artifacts; specialists produce outputs via handoffs only.
- Deterministic resumption stub present; domain guidance lives in specialist prompts/payloads, not in orchestrator code.
