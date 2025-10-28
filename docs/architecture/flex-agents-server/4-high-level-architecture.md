# 4. High-Level Architecture
The flex server keeps the familiar Nitro deployment but swaps the orchestration core for task envelopes, runtime planning, and dynamic context packaging.

```

### Planner Lifecycle Events

1. **`plan_requested`** – After policies are normalized the controller emits this frame, capturing the active capability snapshot, normalized policy keys, and the planner attempt number so clients can render a pending state.
2. **`plan_rejected`** – `PlannerValidationService` validates facet coverage, capability availability, and schema compilation. Failures surface as diagnostics inside `plan_rejected`; the controller immediately requests a revised draft while the run remains paused.
3. **`plan_generated`** – On acceptance the finalized `PlanGraph` (version, node summaries, derived metadata) is emitted and execution begins.
4. **`policy_triggered` + `plan_updated`** – Runtime policy breaches (variant limits, operator feedback, enforcement results) emit `policy_triggered`, request a planner delta, persist a new plan version, and stream `plan_updated` so clients reconcile the new graph before dispatch resumes.

+-----------+      +--------------------+      +--------------------+      +------------------+
| Client UI | ---> | Flex Agents API    | ---> | Planner & Policies | ---> | Execution Engine |
+-----------+      +--------------------+      +--------------------+      +------------------+
      ^                     |                              |                          |
      |                     v                              v                          v
      |            +----------------+            +-------------------+      +----------------------+
      +------------| HITL & Resume  |<-----------| Persistence Layer |<-----| Capability Registry  |
                   +----------------+            +-------------------+      +----------------------+
```
