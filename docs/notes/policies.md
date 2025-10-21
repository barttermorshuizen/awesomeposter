## 1. High-level structure

export interface TaskPolicies {
  /** Policies that influence how the plan is generated. */
  planner?: PlannerPolicy;

  /** Policies that govern runtime behavior after planning. */
  runtime?: RuntimePolicy[];
}


⸻

## 2. Unified Action type (shared across runtime, routing, etc.)

export type Action =
  | { type: "goto"; next: string }
  | { type: "replan"; rationale?: string }
  | { type: "hitl"; rationale?: string }
  | { type: "fail"; message?: string }
  | { type: "pause"; reason?: string }
  | { type: "emit"; event: string; payload?: Record<string, any> };

This is the single execution primitive used by:
	•	runtime policies,
	•	action/routing nodes,
	•	and the execution engine.

⸻

## 3. Runtime policy (Trigger → Action)

export interface RuntimePolicy {
  id: string;
  enabled?: boolean;
  trigger: PolicyTrigger;
  action: Action;
}

export type PolicyTrigger =
  | { kind: "onStart" }
  | { kind: "onNodeComplete"; selector?: NodeSelector; condition?: Record<string, any> }
  | { kind: "onValidationFail"; selector?: NodeSelector; condition?: Record<string, any> }
  | { kind: "onTimeout"; ms: number }
  | { kind: "onMetricBelow"; metric: string; threshold: number }
  | { kind: "manual" };

export interface NodeSelector {
  nodeId?: string;
  kind?: string;
  capabilityId?: string;
}

These policies live and breathe inside the orchestrator loop:
When a trigger condition matches, the engine executes the specified Action.

⸻

## 4. Planner policy (shape and bias of plan generation)

We’ve dropped facets, unified inclusion/exclusion/preference into a single selection object,
and kept a small topology and optimisation section for clarity.

export interface PlannerPolicy {
  /** Structural constraints on the plan itself */
  topology?: {
    variantCount?: number;       // desired branch count
    maxDepth?: number;           // optional graph constraint
    requiredKinds?: string[];    // e.g. ["strategy", "validation"]
    forbiddenKinds?: string[];   // node kinds to avoid entirely
  };

  /** Unified capability and node selection preferences */
  selection?: {
    require?: string[];          // must appear (capability IDs or kinds)
    forbid?: string[];           // never appear
    prefer?: string[];           // positive bias
    avoid?: string[];            // negative bias
  };

  /** High-level optimisation intent */
  optimisation?: {
    objective?: "speed" | "quality" | "diversity" | "token_efficiency";
    maxTokens?: number;
  };

  /** Free-form hints for planner prompt injection */
  directives?: Record<string, unknown>;
}

The planner consumes this once, at plan generation time, to constrain
topology, capability choices, and selection weighting.

⸻

## 5. Example in context

{
  "objective": "Generate 3 LinkedIn post variants",
  "inputs": {
    "brief": "Announce our AI compliance launch"
  },
  "policies": {
    "planner": {
      "topology": { "variantCount": 3 },
      "selection": {
        "require": ["QualityAssuranceAgent.contentReview"],
        "forbid": ["LegacyGeneratorAgent"],
        "prefer": ["ContentGeneratorAgent.linkedinVariants"]
      },
      "optimisation": { "objective": "quality" }
    },
    "runtime": [
      {
        "id": "low_quality_replan",
        "trigger": {
          "kind": "onNodeComplete",
          "selector": { "kind": "validation" },
          "condition": { "<": [{ "var": "qaFindings.overallScore" }, 0.6] }
        },
        "action": { "type": "replan", "rationale": "Low QA score" }
      },
      {
        "id": "medium_quality_hitl",
        "trigger": {
          "kind": "onNodeComplete",
          "selector": { "kind": "validation" },
          "condition": {
            "and": [
              { ">=": [{ "var": "qaFindings.overallScore" }, 0.6] },
              { "<": [{ "var": "qaFindings.overallScore" }, 0.9] }
            ]
          }
        },
        "action": { "type": "hitl", "rationale": "Medium quality requires review" }
      }
    ]
  },
  "outputContract": {
    "schema": {
      "type": "object",
      "required": ["copyVariants"],
      "properties": {
        "copyVariants": {
          "type": "array",
          "minItems": 3,
          "items": {
            "type": "object",
            "required": ["headline", "body"],
            "properties": {
              "headline": { "type": "string" },
              "body": { "type": "string" }
            }
          }
        }
      }
    }
  }
}


⸻

## 6. Why this works

Goal	How this model satisfies it
Clarity	planner vs runtime responsibilities are explicit.
Unified action semantics	One Action type drives everything.
No facet duplication	Output contract remains the single source of truth.
LLM-friendly planner control	Topology + selection are simple to serialize into prompt.
Auditable runtime	Every policy has an id, trigger.kind, and action.type.
Extensible	You can later add weights, scenario tags, or derived profiles without schema churn.




## TL;DR

The final policy type hierarchy is:

TaskPolicies
 ├─ PlannerPolicy     → shapes plan generation (structure, selection, optimisation)
 └─ RuntimePolicy[]   → triggers Actions during execution

Both halves live under TaskEnvelope.policies,
and both are fully type-safe, auditable, and compatible with your new unified Action model.