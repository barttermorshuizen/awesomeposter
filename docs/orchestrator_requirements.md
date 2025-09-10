# Orchestrator Requirements & Implementation Architecture

*(OpenAI Agents SDK — JavaScript)*

---

## 1) Purpose & Scope

Design a **domain-agnostic**, **plan-driven** orchestration agent that coordinates specialist agents **via handoffs only** (no tools), creates its own plan under explicit constraints (quality threshold, execution depth, acceptance criteria), and returns a final bundle:

```
{ result, quality, acceptance-report }
```

All **domain details** (brand, platform, language, must-include lines) live **in prompts/payloads**, not code.

---

## 2) Functional Requirements

### 2.1 Orchestration Behavior

- The Orchestrator:
  - Builds and maintains a **dynamic execution plan** (no hardcoded sequence).
  - Chooses specialists by **capabilities** (from a provided Registry).
  - Delegates **exclusively** via **handoffs**.
  - Enforces constraints:
    - `qualityThreshold` (0..1)
    - `executionDepth` (int)
    - `acceptanceCriteria[]` (text checks)
  - Process: Plan -> (Execute next step in plan -> Update plan)\* -> finalize.
  - Returns **final bundle** only when constraints are satisfied or execution depth is reached.

### 2.2 Agents

- **Strategy Manager**: Creates a rationale, schedule and a writer brief based on a client profile, campaign information (objective, description, etc.). The writer brief contains (a.o.) a setting for the 4 knobs that is based on analysing past performance. The strategy manager has tools to perform this analysis. 
- **Content Generator:** Creates textual content for social media based on a writer brief that includes a client profile (with tone of voice, audience, special instructions), a description of the post, a 4‑knob configuration and a specific platform (like LinkedIn or X).
- **Quality Assurance**: Evaluate content for readability, clarity, objective fit, brand risk, 4-knob distance, acceptance criteria. It returns pass/fail, numeric score, and an issues list.

### 2.3 Inputs

- **User objective/brief** (free text).
- **Registry** of agents & capabilities (names, capability IDs, contracts).
- **Constraints** (quality, execution depth, acceptance criteria).

### 2.4 Outputs

- Stream of orchestrator actions:
  - `plan_update` (patch plan)
  - `handoff` (to agent by name + capabilityId + payload)
  - `final` (bundle with result, quality, acceptance-report)
- Final bundle persisted and returned to caller, contents shaped by the plan.

---

## 3) Non-Functional Requirements

- **Domain-agnostic code**: no brand/platform/tone embedded in code.
- **Deterministic resumption**: resume from stored `plan` + `history`.
- **Observability**: tracing of handoffs, artifacts, QA scores, execution depth.
- **Safety/Compliance**: prompt hygiene, content guards (in QA).
- **Performance**: bounded turn count per run (`maxTurns`) and bounded execution depth.
- **Reliability**: idempotent persistence; retries on transient failures.

### 3.1 Modes: Chat vs App

- **Chat mode**

  - Purpose: freeform conversation with a single agent (orchestrator **or** a chosen specialist) where the output is human‑readable text.
  - Behavior: no planning/registry constraints are enforced; no structured bundle is required.
  - SSE frames to expect:
    - `start`, `phase` (usually `analysis`), `delta` (text tokens), `message` (normalized final text), `metrics`, `complete` (`{ message }`).
  - Final output shape: `{ message: string }`.
  - Notes: still **must not** leak the orchestrator’s system prompt when proxying to a specialist.

- **App mode**

  - Purpose: plan‑driven orchestration via **handoffs only** to produce a structured final bundle.
  - Behavior: enforces constraints (`qualityThreshold`, `executionDepth`, `acceptanceCriteria`) and plan evolution.
  - SSE frames to expect:
    - `start`, `phase` (planning/analysis/generation/qa/finalization), `handoff` (`requested|occurred`), `tool_call`, `tool_result`, `delta` (only during generation/qa), `warning`, `metrics`, `complete` (bundle).
  - Final output shape: `{ result, quality, acceptance-report }` (plan‑shaped contents).
  - Notes: on handoff, **do not** propagate the orchestrator’s system prompt; send only payload + filtered relevant context/history.

---

## 4) Streaming & SSE Frames (Contract)

The orchestrator emits **Server‑Sent Events (SSE)** throughout a run. Clients must treat this as the authoritative telemetry stream.

**Required frames (type → payload):**

- `start` → `{ correlationId, message }`

  - Emitted once at the beginning of a run.

- `phase` → `{ phase, message, correlationId }`

  - Phases: `planning | analysis | generation | qa | finalization`.
  - Emit on entering a new phase (e.g., after a handoff to a specialist).

- `handoff` → `{ message, data: { from?, to? }, correlationId }`

  - `message` values: `requested | occurred | <sdk-variant>`.
  - `requested` when the orchestrator proposes a transfer; `occurred` when control switches.

- `delta` → `{ message, correlationId }`

  - Token/partial text **only** during specialist output phases: `generation` or `qa`.
  - Suppress deltas in other phases.

- `tool_call` → `{ message: toolName, data: { args }, correlationId }`

  - Emit when a specialist calls a tool.

- `tool_result` → `{ message: toolName, data: { result }, correlationId }`

  - Emit when a tool returns.

- `message` → `{ message, correlationId }`

  - For discrete textual messages not suited to `delta` (e.g., reasoning notes in debug builds or normalized chat output).

- `warning` → `{ message, data?, correlationId }`

  - Emit when expected specialist involvement was not observed (e.g., drafts produced without Content; QA skipped).

- `metrics` → `{ tokens?, durationMs?, correlationId }`

  - Emit periodically (per agent turn if available) and once at the end (aggregate totals).

- `error` → `{ message, data?: { stack? }, correlationId }`

  - Emit on exceptions; the route layer SHOULD NOT emit a duplicate error.

- `complete` → `{ data, durationMs, correlationId }`

  - Final frame. `data` MUST be the final bundle shaped by the plan, e.g. `{ result, quality, acceptance-report }`.

**Correlation:** Every frame MUST include the `correlationId` of the run.

**Prompt hygiene on handoff:** When handing off, **do not propagate the orchestrator’s system prompt**; send only the intended payload plus relevant context/history (already filtered to remove orchestration sentinels and artifacts).

---

## 5) Agent Contracts

### 5.1 Orchestrator (handoffs-only)

- **System prompt (core rules):**

  - You **never** write domain artifacts yourself.
  - You **never** call tools; you **only** produce `handoff`, `plan_update`, or `final`.
  - Build/evolve a minimal plan using capabilities from **Registry**.
  - After each handoff, update **Plan** and evaluate constraints.
  - If `score < qualityThreshold` and `depth < executionDepth`, schedule revision.
  - Finalize only when constraints are met or execution depth reached. Be concise.

- When performing a handoff, do not propagate the orchestrator's system prompt to the specialist agent; only send the intended payload and relevant context.

- **Output schema (union):**

  - `{ action:'plan_update', planPatch, note? }`
  - `{ action:'handoff', to, capabilityId, payload, note? }`
  - `{ action:'final', bundle:{ artifacts, summary } }`

### 5.2 Specialists (examples)

- **StrategyManager** capability: `plan.strategy`
  - Input: brief, audience, objective, priorPerformance?, knobs?
  - Output: `{ strategy: { schedule[], rationale, knobs } }`
- **ContentWriter** capabilities: `content.brief`, `content.write`
  - Inputs:
    - brief mode: clientBrief, strategy?, knobs?, constraints
    - write/revise mode: writerBrief, platform, language, mustInclude, revisionNotes?
  - Output: `{ brief: ... }` **or** `{ draft: { text, metadata? } }`
- **QAAgent** capability: `qa.review`
  - Input: draft, acceptanceCriteria[], mustInclude?, platform, language
  - Output: `{ qa: { pass:boolean, score:number, issues:string[] } }`

> All specialist prompts **derive domain details from payloads**; nothing is hardcoded.

---

## 6) Implementation Architecture (OpenAI Agents SDK — JS)

### 6.1 Components

- **Orchestrator Agent**: configured with **handoffs** (no tools).
- **Specialist Agents**: each declares outputs and is registered as a handoff target.
- **Runner**: executes multi-turn conversations; maintains in-run history.
- **Persistence Layer**: store `history`, `plan`, and `artifacts` keyed by `threadId`.
- **Registry Provider**: runtime list of agents + capabilities.
- **Tracing/Telemetry**: capture run/turn IDs, handoff graphs, scores.

### 6.2 Wiring (high-level)

1. **Register specialists** and expose them as **handoffs** on the Orchestrator.
2. **Start/Resume** with `(history, plan, registry, constraints)` context.
3. **Run** the Orchestrator via `Runner.run()`.
4. If `handoff`:
   - Execute the selected specialist (second `Runner.run()` or a helper).
   - Persist returned artifact under `plan.artifacts[artifactKey]`.
   - Re-run the Orchestrator to decide next step.
5. If `plan_update`: persist patch and re-run.
6. If `final`: return bundle; persist and exit.

---

## 7) Prompts (payload-only domain snippets)

- **Strategy payload**: audience, objective, priorPerformance?, knobs.
- **Writer payloads**: mode ('brief'|'draft'|'revise'), clientBrief, strategy, knobs, constraints, platform, language, mustInclude.
- **QA payload**: draft, acceptanceCriteria[], platform, language, mustInclude, qualityThreshold.

---

## 8) Error Handling, Guardrails, and Event Streaming

- The orchestrator emits Server-Sent Events (SSE) frames during runs. It must consistently emit:
  - `start` when a run begins.
  - `phase` whenever entering a new orchestration phase (planning, analysis, generation, qa, finalization).
  - `handoff` when a handoff is requested or occurred, including from/to agent names.
  - `delta` for partial content text during generation/qa phases.
  - `tool_call` when a specialist invokes a tool, including arguments.
  - `tool_result` when a tool returns results.
  - `metrics` with token usage and duration.
  - `message` for informational or reasoning text not belonging to deltas.
  - `warning` for anomalies (e.g., no content/QA involvement).
  - `error` on any error conditions.
  - `complete` when orchestration finalizes, with the final bundle.

---

## 9) Observability

- Schema enforcement (reject/re-prompt if mismatch).
- Turn & loop bounds (`maxTurns`, `executionDepth`).
- Missing capability: orchestrator must replan or finalize with explanation.
- QA checks include safety/brand/tone/platform compliance.
- Trace IDs + workflowName per run.
- Log step transitions, artifacts, QA scores, depth progression.
- Export handoff graph for debugging.

---

## 10) Acceptance Criteria

- Orchestrator never emits domain artifacts directly.
- Produces `{ result, quality, acceptance-report }` bundle with given specialists, aligned to the plan's defined outputs.
- Respects must-include and language/platform rules.
- Enforces quality & execution depth constraints.
- Resumable via stored `plan` + `history`.

---

## 11) Test Plan

1. Happy path: first draft passes QA.
2. One revision: first fails, second passes.
3. Execution depth limit hit: finalize best effort.
4. Missing capability: orchestrator replans or finalizes with explanation.
5. Persistence: crash/restart; resume plan.
6. Domain isolation: confirm code has no brand/platform strings.

---

## 12) Future Extensions

- Multiple writers/QA agents; orchestrator chooses dynamically.
- Learning loop from QA + engagement metrics.
- Human-in-the-loop approvals at critical plan steps.