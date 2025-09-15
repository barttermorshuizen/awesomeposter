# Orchestrator MVP TODO (Persistent)

This checklist mirrors the active task Reminders and will be kept in sync. It implements the spec in [orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md:1). Edit via PR; the assistant will reconcile changes.

## Checklist

- [x] Decide and lock the final bundle schema in shared as { result, quality, acceptance-report } and update orchestrator parsing and emit sites to match. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:406), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [x] Make orchestrator code domain-agnostic: refactor TRIAGE_INSTRUCTIONS to remove social-specific details and tool names, moving them into specialist prompts/payloads. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts), [strategy-manager.ts](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts), [content-generator.ts](awesomeposter/packages/agents-server/src/agents/content-generator.ts), [quality-assurance.ts](awesomeposter/packages/agents-server/src/agents/quality-assurance.ts)
- [x] Introduce a minimal Plan type and Registry abstraction inside OrchestratorAgent; maintain and emit plan_update SSE frames when plan changes during a run. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [x] LLM-driven planning loop: remove static plan seeding and phase-based gating; have the orchestrator/LLM propose the initial plan and emit plan_update patches as it revises the plan during the run. Implement plan patch merge/apply and plan-driven step progression. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts), [docs/orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md)
- [ ] Consolidate orchestrator data models: move Plan and PlanStep types into shared, define shared StepResult and RunReport types, and normalize planner outputs. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [x] Refactor OrchestratorAgent.run into explicit plan → step → result → replan transitions while preserving RESUME_STORE and SSE emissions. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [ ] Trim specialist agents to minimum tools and ensure each returns a structured StepResult; remove any replanning logic. Touch: [strategy-manager.ts](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts), [content-generator.ts](awesomeposter/packages/agents-server/src/agents/content-generator.ts), [quality-assurance.ts](awesomeposter/packages/agents-server/src/agents/quality-assurance.ts)
- [ ] Capability-driven registry wiring: generate triage handoffs from an app-level capability Registry (not hardcoded roles). Expose transfer_to_<capability_id> tool names and rich descriptions; support per-run allowlists/policy. Touch: [agents-container.ts](awesomeposter/packages/agents-server/src/services/agents-container.ts), [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts), [agent-runtime.ts](awesomeposter/packages/agents-server/src/services/agent-runtime.ts)
- [x] Prompt changes for planning: revise [buildSystemPrompt()](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:513) and [TRIAGE_INSTRUCTIONS](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:224) to instruct proposing an initial plan from Registry capabilities + constraints and emitting plan_update patches; remove the prescriptive “Plan → Generate → QA → Finalize”. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [x] Remove orchestrator fallback synthesis of outputs; on empty/invalid final output, emit warning and finalize with explanation. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [x] Add a lightweight persistence/resume mechanism (in-memory map keyed by threadId or briefId) to store plan and history; allow resume on subsequent calls. Touch: [run.stream.post.ts](awesomeposter/packages/agents-server/routes/api/v1/agent/run.stream.post.ts), [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [x] Align SSE framing with the doc: ensure delta only during generation/qa (already), and add plan_update frames with meaningful plan patches. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [ ] Generalize telemetry and guards: remove domain-specific flags and warnings; detect specialist involvement by capability/agent identity (not tool names) and use domain‑neutral terms (e.g., “generation specialist”, “artifacts”). Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts)
- [x] Stream‑driven plan_update ingestion: parse LLM outputs/run items for structured plan_update patches, apply immediately, and emit SSE; keep delta gating to generation/qa only. Touch: [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts), [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts)
- [ ] Update shared schema/types and consumers to the new bundle; fix tests and normalization. Touch: [agent-run.ts](awesomeposter/packages/shared/src/agent-run.ts), [normalize-app-result.ts](awesomeposter/src/lib/normalize-app-result.ts)
- [ ] Add unit/integration tests: prompt sentinel presence in buildSystemPrompt, handoff filtering correctness, plan_update emission, final bundle schema validation, and warnings when content/QA involvement is missing. Touch: [prompt-filters.spec.ts](awesomeposter/packages/agents-server/__tests__/prompt-filters.spec.ts), [handoff-filtering.integration.spec.ts](awesomeposter/packages/agents-server/__tests__/handoff-filtering.integration.spec.ts)
- [ ] Add integration tests for a full orchestrated run using mock agents and extend telemetry tests for token/runtime budgets. Touch: [plan-run.integration.spec.ts](awesomeposter/packages/agents-server/__tests__/plan-run.integration.spec.ts), [telemetry.spec.ts](awesomeposter/packages/agents-server/__tests__/telemetry.spec.ts)
- [ ] Review and tighten tool allowlists/policy are enforced via specialists only; confirm Orchestrator has no tools configured. Touch: [agent-runtime.ts](awesomeposter/packages/agents-server/src/services/agent-runtime.ts:60), [orchestrator-agent.ts](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:238)
- [ ] Write migration notes summarizing changes and how to resume existing threads or start fresh. Touch: [README.md](awesomeposter/README.md), [docs/orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md:1)
- [ ] Document required environment variables for Agents SDK, persistence, and feature flags. Touch: [README.md](awesomeposter/README.md), [docs/orchestrator-as-code.md](awesomeposter/docs/orchestrator-as-code.md)

## Key implementation references

- Orchestrator entrypoint and run loop: [OrchestratorAgent.run()](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:83)
- System prompt sentinel wrapping: [buildSystemPrompt()](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:476), sentinels [prompt-filters.ts](awesomeposter/packages/agents-server/src/utils/prompt-filters.ts:6)
- Handoff filtering utilities: [composeInputFilterSync](awesomeposter/packages/agents-server/src/services/orchestrator-agent.ts:30), [composeInputFilter()](awesomeposter/packages/agents-server/src/utils/prompt-filters.ts:139)
- SSE route: [run.stream.post.ts](awesomeposter/packages/agents-server/routes/api/v1/agent/run.stream.post.ts:1)

## Sync policy

- This file is authoritative for the orchestrator MVP TODO.
- The assistant will update this file and the task Reminders in lock‑step as items are completed.

## Acceptance

- Matches the SSE framing and bundle contract from [orchestrator_requirements.md](awesomeposter/docs/orchestrator_requirements.md:87).
- No orchestrator-authored artifacts; specialists produce outputs via handoffs only.
- Deterministic resumption stub present; domain guidance lives in specialist prompts/payloads, not in orchestrator code.