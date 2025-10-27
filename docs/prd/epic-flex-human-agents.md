# Flex Human Agent Participation - Brownfield Enhancement

## Epic Goal
Introduce first-class human capabilities into the flex orchestration stack so planners, runtime execution, and operator tooling can schedule, guide, and resume human-driven work with the same determinism, auditability, and facet contracts used for AI agents.

## Epic Description

**Existing System Context**
- Current flex runtime supports dynamic planning across AI capabilities with HITL governance triggered by runtime policies.
- Operators engage through HITL approval flows but cannot be scheduled as deterministic plan nodes.
- Capability Registry, planner lifecycle, and SPA UI are optimized for AI-only nodes with limited support for human task surfaces.

**Enhancement Details**
- Register `agentType: "human"` capabilities in the registry with facet-backed input/output contracts and instruction templates.
- Extend planner and execution engine to emit, persist, and resume `HumanAgent.*` nodes, including assignment metadata and deterministic pause/resume semantics.
- Deliver facet-driven task surfaces in the SPA (and notification plumbing) so human operators receive structured briefs, submit contract-compliant outputs, and keep runs progressing.
- Ensure offline/backlog handling and policy-driven escalations work for human nodes without disrupting existing HITL approvals.

**Integration Considerations**
- Reuse shared TaskEnvelope, facet catalog, and SSE event contracts defined for flex agents.
- Persist human-node lifecycle, assignment hints, and structured outputs alongside existing flex tables (for example `flex_plan_nodes`, HITL metadata).
- Notification services and `/api/v1/flex/tasks` endpoints must discover pending human work without breaking current operator experiences.
- Feature-flag rollout should isolate human-agent participation until parity and operator readiness are validated.

**Success Criteria**
- Planner can deterministically insert human capabilities into plan graphs and surface them through existing SSE telemetry.
- Execution engine validates human submissions against facet-derived contracts and resumes runs without manual intervention.
- SPA renders responsive task surfaces composed from facet widgets, including assignment metadata, and supports offline backlog processing.
- Operational metrics demonstrate that human participation preserves audit trails, resume determinism, and policy governance parity with AI-only runs.

## Candidate Stories
1. Define and register human capability contracts in the Capability Registry, including facet coverage and instruction templates.
2. Update planner + execution lifecycle to schedule, persist, and resume `HumanAgent.*` nodes with assignment metadata and deterministic validation.
3. Build facet-driven SPA task surfaces (widget registry, submission flow, offline backlog handling) for human nodes.
4. Extend notification/assignment plumbing (`flex/tasks`, routing hooks, alerts) to surface pending human work and escalations.
5. Document operations, rollout, and governance updates for human participation, including policy guardrails and troubleshooting runbooks.

## Compatibility Requirements
- [ ] Legacy flex AI planning remains unaffected when human capabilities are feature-flagged off.
- [ ] Existing HITL approval flows operate unchanged for policy-triggered pauses when human capabilities are enabled.
- [ ] Database changes for human metadata are additive and backwards compatible.
- [ ] SSE event signatures remain stable for existing clients, with human-specific fields added in documented extension points.

## Risk Mitigation
- **Planner & Execution Complexity:** Introduce targeted telemetry and test coverage for human-node lifecycle to detect regressions early.
- **Operator Experience Drift:** Feature-flag UI/task-surface changes and pilot with select operator cohorts; capture feedback before broad rollout.
- **Offline Backlog Handling:** Validate queue APIs and resume flows under prolonged operator downtime to ensure determinism.
- **Policy Conflicts:** Document interplay between runtime policies (timeouts, metric triggers) and human node assignments to avoid unhandled escalations.

## Definition of Done
- [ ] Candidate stories refined into approved story files with acceptance criteria and testing expectations.
- [ ] Human capabilities registered, planned, executed, and resumed behind a gating mechanism with automated coverage.
- [ ] SPA and notification tooling deliver facet-driven task experiences with operator sign-off.
- [ ] Operational documentation updated (architecture section, operator runbooks) with human participation guidance.
- [ ] Monitoring and telemetry capture human-node lifecycle events for ongoing health checks.
