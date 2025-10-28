# 5.10 Policy Simplification (Remove Flow-Control Actions)

## Background

Earlier versions allowed **runtime policies** to trigger direct flow manipulation via goto actions.

These policies referenced specific NodeSelector criteria (nodeId, kind, capabilityId, etc.) to jump execution to another node.

Example (to be deprecated):

```
{
  "id": "hitl_reject_goto_previous",
  "trigger": { "kind": "manual" },
  "action": {
    "type": "goto",
    "next": { "relation": { "direction": "previous", "filter": { "kind": "execution" } } }
  }
}
```

This approach conflated **control flow** (a planner concern) with **guardrail enforcement** (a runtime concern).

Under the new model, plan topology is immutable once validated; policies may **pause**, **fail**, or **request replanning**, but they never re-route nodes.

## Deprecated Elements

| Type | Name | Replacement | Notes |
| ----- | ----- | ----- | ----- |
| **Action** | goto | — | Removed entirely. Flow changes now require replanning. |
| **Action** | goto.previous, goto.next, etc. | — | Deprecated synonyms; no replacements. |
| **Action Property** | onEmpty | — | No longer relevant once goto is removed. |
| **Trigger Kind** | Any trigger relying on node navigation (e.g., selector.relation) | Simplify to direct event-based triggers | Only event detection remains. |
| **NodeSelector.relation** | previous / next navigation | — | Removed; selectors remain static (by kind or capability only). |


## Updated RuntimePolicy Action Union

Replace the previous union:

```
export type Action =
  | { type: "goto"; next: NodeSelector; maxAttempts?: number }
  | { type: "replan"; rationale?: string }
  | { type: "hitl"; rationale?: string; approveAction?: Action; rejectAction?: Action }
  | { type: "fail"; message?: string }
  | { type: "pause"; reason?: string }
  | { type: "emit"; event: string; payload?: Record<string, any> }
```

with:

```
export type Action =
  | { type: "replan"; rationale?: string }
  | { type: "hitl"; rationale?: string; approveAction?: Action; rejectAction?: Action }
  | { type: "fail"; message?: string }
  | { type: "pause"; reason?: string }
  | { type: "emit"; event: string; payload?: Record<string, any> }
```

goto is fully removed.

## Policy Purpose (Post-cleanup)

Policies are now strictly **orthogonal** to plan control flow.

They operate as *guardrails* responding to signals emitted by the execution engine.

| Category | Example | Action |
| ----- | ----- | ----- |
| **Safety** | Output validation failed repeatedly | replan |
| **Compliance** | Detected brand-risk phrase | pause \+ operator HITL |
| **Operational** | Timeout exceeded | fail or replan |
| **Observability** | Threshold event or custom metric | emit |

Policies **never** mutate the plan graph or redirect node order.

If control-flow correction is needed, the policy requests a **replan**, prompting the planner to regenerate a graph that satisfies constraints anew.

## Execution Engine Behavior Change

* Execution engine now treats PlanGraph as immutable during runtime.

* Any flow adjustment (skipping, inserting, or reordering nodes) must originate from a new planner revision, not an action.

* When a policy triggers a replan, the engine emits policy\_triggered → plan\_requested → plan\_generated sequence and resumes from the newly validated graph version.


## Rationale

* **Clear semantics:** Plan graphs become the sole representation of flow.

* **Predictable execution:** Runtime never alters topology.

* **Simpler validation:** Plan satisfiability only needs to be proven once.

* **Fewer edge cases:** Eliminates state divergence between planner and runtime.

* **More declarative consistency:** All changes to flow originate from revised planning, not procedural hops.


**Design Principle**

*Policies guard the run; planners shape the path.*  
Once validated, the plan graph is the single source of truth for control flow.  
