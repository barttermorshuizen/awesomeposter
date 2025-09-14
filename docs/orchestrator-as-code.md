# Orchestrator-as-Code Refactoring Plan

This plan updates the existing orchestrator implementation to the code-first architecture described in `docs/orchestrator_requirements.md`. Instead of starting from scratch, it builds on the current `OrchestratorAgent` and related agents in `packages/agents-server`.

## 1. Consolidate Data Models
- Move the ad-hoc `Plan` and `PlanStep` types from `packages/agents-server/src/services/orchestrator-agent.ts` into `packages/shared`.
- Extend `packages/shared/src/agent-run.ts` with shared `StepResult` and `RunReport` types used across orchestrator and specialists.
- Normalize existing planner outputs to these shared structures.

## 2. Orchestrator Engine Refactor
1. **State Machine**
   - Restructure `OrchestratorAgent.run` into explicit `plan → step → result → replan` transitions.
   - Preserve existing persistence (`RESUME_STORE`) and SSE emissions.
2. **Planning & Replanning**
   - Replace the current plan seeding with calls to the LLM planner, merging patches with `normalizePlanPatchInput`.
   - Keep the critic hook but surface scores through the existing telemetry pipeline.
3. **Step Execution**
   - Continue dispatching to registered specialists via `AgentRuntime`, enforcing retries and timeouts.
4. **Result Integration**
   - Aggregate `StepResult` data into a shared `RunReport` and persist alongside the plan for resumability.

## 3. Specialist Agents
- Reuse existing strategy, generation, and QA agents in `packages/agents-server/src/agents/*`.
- Trim their tools to the minimum needed and ensure each returns a structured `StepResult`.
- Remove any residual replanning logic; specialists should only act on received steps.

## 4. Event Streaming
- Map current log events to the SSE contract in `docs/orchestrator_requirements.md`.
- Emit `plan_update`, `handoff`, `delta`, and `final` events from `OrchestratorAgent` with delta-only semantics.
- Maintain hooks for UI approvals before continuing past checkpoints.

## 5. UI & Server Integration
- Continue exposing `/api/v1/agent/run.stream` and align legacy workflow routes to this entry point.
- Ensure the front-end components subscribe to the SSE stream and render plan progress and artifacts.

## 6. Testing & Hardening
- Update existing Vitest suites under `packages/agents-server/__tests__` to cover plan parsing, handoff filtering, and SSE framing.
- Add integration tests that execute a full run using mock agents.
- Extend telemetry tests for token and runtime budgets.

## 7. Deployment Notes
- Deploy orchestrator and specialists via the existing agents server package.
- Document required environment variables for the Agents SDK, persistence, and feature flags.
