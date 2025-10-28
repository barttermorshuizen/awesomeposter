# 5.9 Output Contracts, Planner Validation, and Policy Semantics

**Overview**

This section defines how envelopes express outcome contracts, how the planner/validator loop proves symbolic satisfiability, and how runtime policies remain orthogonal guardrails. The intent is a contract → plan → proof → run → guardrail pipeline with deterministic validation at every gate.

## 5.9.1 OutputContract Specification

```ts
export interface OutputContract {
  /** JSON Schema describing expected shape and type of the result. */
  schema: JSONSchema7

  /** Optional post-processing hints (field order, normalization preferences, etc.). */
  hints?: Record<string, unknown>

  /** Declarative constraints that must hold true on the final output. */
  constraints?: ConstraintSpec[]
}

export interface ConstraintSpec {
  /** JSONLogic-style expression over the output structure. */
  expr: Record<string, any>

  /** Severity of the constraint. Determines planner responsibility. */
  level: 'hard' | 'soft' | 'informational'

  /** Optional description or rationale for planner feedback. */
  rationale?: string
}
```

**Semantics**

- `schema` defines the full merged contract a valid output must satisfy.
- `constraints` declare truths about that structure; they never encode actions or procedural hints.
- The planner must produce a plan graph that can, in principle, satisfy every `hard` constraint using the capabilities it selects.
- The validator operates symbolically over node metadata and merged contracts; runtime validation simply confirms the already-proven truths.

**Severity semantics (hard/soft/informational)**

- `hard`
  - Effect: any unsatisfied hard constraint blocks `plan_generated` (validator emits `plan_rejected`).
  - Planner responsibility: propose a plan that can satisfy every hard constraint symbolically (producer + enforcement path).
- `soft`
  - Effect: never blocks `plan_generated`. Unsatisfied soft rules lower `satisfactionScore` and surface as diagnostics with `cause: unsatisfied_soft`. Missing producers still emit non-blocking guidance so the planner can optimize subsequent drafts.
- `informational`
  - Effect: does not influence acceptance or scoring. Serves as advisory context for the planner and UI only.

## 5.9.2 Planner Validation and Feedback Loop

Planner validation is a deterministic, test-driven cycle:

1. **Draft proposal** – `PlannerService` (LLM-backed) receives the normalized `TaskEnvelope` (objective, outputContract, constraints, policies) and emits a candidate `PlanGraph`.
2. **Structural validation** – `PlannerValidationService` proves DAG integrity, node completeness, facet directionality, and schema compilability (Ajv/Zod).
3. **Constraint satisfaction testing** – `PlanSatisfactionTester` evaluates the plan symbolically, confirming a producer/enforcer exists for every declared constraint level and recording per-constraint scores.
4. **Feedback emission**
   - If all hard constraints are satisfiable → emit `plan_generated`.
   - If any hard constraint fails → emit `plan_rejected` with structured diagnostics specific to the failing node or capability.
5. **Planner iteration** – the LLM receives deterministic diagnostics and regenerates until acceptance. Prompt scaffolding references `constraintId`, `cause`, and `suggestion` directly so the loop converges quickly.

## 5.9.3 Validator Orchestration, Diagnostics, and Scoring

```
PlannerService (LLM draft PlanGraph)
        │
        ▼
StructuralValidator ─┐
  - DAG integrity     │
  - node shape        │
                      │
FacetValidator ───────┤   → PlanDiagnostic[]
  - input/output      │
  - facet coverage    │
                      │
ConstraintValidator ──┘
  - hard/soft/info constraints

           ▼
DiagnosticsMerger
  - dedupe key: (constraintId∥hash, nodeId∥*, cause)
  - severity dominance (hard > soft > informational)
  - aggregate unique suggestions (newline separated)
  - sort: severity → constraintId → nodeId
  - compute bundle status + satisfactionScore
           │
           ├─ status = rejected              → emit plan_rejected.payload
           └─ status = accepted/with_findings → emit plan_generated.payload
```

```ts
export interface PlanDiagnostic {
  severity: 'hard' | 'soft' | 'informational'
  status: 'unsatisfied' | 'satisfied' | 'unknown'
  constraint?: string
  constraintId?: string
  nodeId?: string
  capabilityId?: string
  cause: 'missing_producer' | 'missing_enforcer' | 'schema_incompatible' | 'unsatisfied_soft' | 'advisory'
  suggestion?: string
  details?: Record<string, any>
}
```

**Merge algorithm**

1. Dedupe key: `(constraintId || hash(constraint), nodeId || '*', cause)`.
2. Severity dominance: retain the highest-severity diagnostic; merge unique suggestions separated by newlines.
3. Stable ordering: sort by severity (`hard` > `soft` > `informational`), then `constraintId`, then `nodeId`.
4. Bundle status:
   - `rejected` if any `severity = hard` diagnostic is `unsatisfied`.
   - `accepted_with_findings` if no hard failures exist but any soft/informational diagnostic is `unsatisfied` or `advisory`.
   - `accepted` otherwise.

**Satisfaction score**

- Per-constraint score `s_i`:
  - Hard → `1` if satisfiable, else `0`.
  - Soft → `1` if satisfiable, else `0` (lower weight).
  - Informational → excluded from scoring.
- Default weights: `w_hard = 1.0`, `w_soft = 0.5`.
- Overall: `satisfactionScore = (Σ w_i * s_i) / (Σ w_i)`.
- Persistence:
  - Emit on `plan_generated.payload.satisfactionScore` and store on the `flex_runs` record for analytics.
  - Execution engine recomputes `observedSatisfaction` after runtime validations complete to compare symbolic vs. realized quality.

## 5.9.4 Feedback Payloads and Telemetry

All validator outputs use the normalized diagnostic buckets below so planner prompts can be templated without guesswork:

```json
{
  "status": "rejected | accepted | accepted_with_findings",
  "satisfactionScore": 0.0,
  "failures": [
    {
      "severity": "hard",
      "status": "unsatisfied",
      "constraint": "qaFindings.overallScore >= 0.8",
      "constraintId": "min_qa",
      "cause": "missing_producer",
      "nodeId": "publish-1",
      "capabilityId": "QualityAssuranceAgent.contentReview",
      "suggestion": "Insert QualityAssuranceAgent.contentReview before Publish."
    }
  ],
  "warnings": [
    {
      "severity": "soft",
      "status": "unsatisfied",
      "constraint": "copyVariants.length == 2",
      "constraintId": "exact_two",
      "cause": "unsatisfied_soft",
      "suggestion": "Expand branch node to produce exactly 2 variants."
    }
  ],
  "infos": [
    {
      "severity": "informational",
      "status": "unknown",
      "constraint": "toneOfVoice documented",
      "constraintId": "tone_hint",
      "cause": "advisory",
      "details": { "note": "Planner may prefer 'professional' for B2B." }
    }
  ]
}
```

- Field names are fixed: `constraint`, `constraintId`, `cause`, `suggestion`.
- Buckets: `failures[]` (hard), `warnings[]` (soft), `infos[]` (informational).
- `plan_rejected.payload` carries the merged diagnostics; the controller immediately requests a revised draft while the stream stays open.
- `plan_generated.payload` includes `planVersion`, trimmed node metadata (`nodeId`, `capabilityId`, `provides[]`, `enforces[]`), and the same diagnostic buckets for transparency.
- `policy_triggered` and `plan_updated` events reuse the schema when policies introduce additional findings (topology only changes after a replan).

## 5.9.5 Constraints vs. Policies Separation

- **Rule of separation**
  - Constraints define what must be true at completion (design/compile time).
  - Policies govern runtime guardrails; they react to events and never reshape topology.
- **Use the contract when** you assert properties of the final artifact (for example `exactly 2 variants`, `qaFindings.overallScore >= 0.8`, `CTA present`). Encode these in `outputContract.schema` and `constraints`.
- **Use policies when** you control runtime behaviour (timeouts, retries, HITL gates, replans, brand-risk pauses). These live under `TaskEnvelope.policies.runtime`.

Examples:

```ts
// Constraint (belongs in contract)
constraints: [
  {
    constraintId: 'min_qa',
    expr: { '>=': [{ var: 'qaFindings.overallScore' }, 0.8] },
    level: 'hard'
  }
]
```

```json
{
  "id": "qa_runtime_guardrail",
  "trigger": { "kind": "onNodeComplete", "nodeId": "publish-1" },
  "condition": { "between": [{ "var": "qaFindings.overallScore" }, 0.6, 0.8] },
  "action": { "type": "hitl", "rationale": "Score between 0.6 and 0.8 requires human review" }
}
```

**Conflict resolution**

- Plan acceptance: contract rules win. Any unsatisfied hard constraint rejects the plan; policies cannot override.
- During execution: policies may pause, escalate, or trigger replans even if the contract is satisfiable. Plan topology remains unchanged except through explicit replanning.
- If caller policies contradict the contract schema (for example `variantCount = 3` while schema `maxItems = 2`), the validator surfaces a `schema_incompatible` hard diagnostic. The planner must reconcile the conflict before acceptance.

## 5.9.6 Role Separation and Collaboration

| Layer | Responsibility | Determinism |
| --- | --- | --- |
| TaskEnvelope | Declares objective and desired outcome (OutputContract). | Declarative |
| PlannerService (LLM) | Synthesizes plan graph that satisfies constraints. | Probabilistic proposal, deterministically validated |
| PlannerValidationService / PlanSatisfactionTester | Validate structure and constraint satisfiability; emit feedback. | Deterministic |
| ExecutionEngine | Executes only validated plans; enforces schema and constraints. | Deterministic |
| Policies Layer | Orthogonal runtime guardrails (timeouts, retries, HITL). | Deterministic but event-driven |

## 5.9.7 Policies as Orthogonal Guardrails

Policies operate outside of planning and constraint satisfaction. They do not alter topology or structure and instead monitor runtime telemetry to enforce safety, compliance, or operator rules.

- Reactive, not predictive — triggered by execution events.
- Non-topological — never add, remove, or rewire plan nodes.
- Guardraily, not generative — constrain behaviour rather than define it.
- Typical actions: retries, timeouts, HITL enforcement, compliance failsafes, metric-triggered replans or emissions.

## 5.9.8 Conceptual Flow Summary

```
TaskEnvelope
  └─ OutputContract (schema + constraints)
        ↓
    PlannerService (LLM)
        ↓ proposes
    PlannerValidationService + PlanSatisfactionTester
        ↓ validate + emit diagnostics
    plan_generated → ExecutionEngine
        ↓ executes
    Policies Layer
        ↳ monitors runtime signals (timeouts, validation failures)
        ↳ triggers guardrail actions (pause, replan, fail)
```

**Design principle**: contracts define what must be true; planners decide how to make it true; validators prove it could be true; policies ensure nothing breaks while trying.
