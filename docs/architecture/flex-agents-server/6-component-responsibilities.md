# 6. Component Responsibilities
- `FlexRunController`: validates envelopes, seeds correlation IDs, and emits initial SSE frames.
- `PolicyNormalizer`: validates and normalizes caller-supplied policies (personas, variant counts, compliance rules) before the planner consumes them.
- `CapabilityRegistry`: accepts registration payloads from agents, persists capability metadata, performs similarity search, and resolves fallbacks when the ideal agent is unavailable.
- `PlannerService`: synthesizes `PlanGraph` nodes from the objective, policies, and capabilities, and updates the plan if policies change mid-run.
  - The planner prompt now provides **capability contract schemas** (input/output JSON Schema or facet lists) so the planner can reason about required fields and enumerations before emitting nodes.
  - Normalisation nodes (`kind: transformation`) are injected only when the planner detects a contract mismatch; if the capability already satisfies the caller schema the plan omits the extra node and execution proceeds directly.
- `ContextBuilder`: assembles `ContextBundle` instances, redacting sensitive inputs when necessary, and attaches return schemas.
- `ExecutionEngine`: resolves capabilities via the registry, sequences node execution, streams `flex_capability_dispatch_*` telemetry, handles retries, and coordinates with the HITL gateway for approval-required tasks.
- `OutputValidator`: runs Ajv against caller contracts and capability defaults, emits structured `validation_error` frames with scope/context, and prompts rewrites when agents fail validation.
- `PersistenceService`: stores run metadata, plan graphs, and variant outputs to support rehydration, analytics, and audit trails.
- `TelemetryService`: streams normalized `FlexEvent` frames (`plan_requested`, `plan_rejected`, `plan_generated`, `plan_updated`, `policy_triggered`, `node_*`, `hitl_request`, `validation_error`, `complete`) for UI consumption.

## Telemetry & Metrics Parity

- **Event payloads** now include `planVersion`, `correlationId`, and `facetProvenance` for every planner/node/policy/HITL/validation/complete frame to keep dashboards aligned with the legacy orchestrator. `facetProvenance` mirrors the facet compiler output so operators can trace schema provenance without replaying a run.
- **Structured logs** emitted alongside the frames use the legacy names (`flex_plan_requested`, `flex_node_complete`, `flex_policy_triggered`, `flex_validation_failed`, etc.) with the expanded fields above. This keeps Loki/Grafana queries working while enabling richer faceting.
- **Metrics** captured for parity:
  - Counters: `flex.planner.requests`, `flex.planner.rejections`, `flex.planner.generated`, `flex.planner.updated`, `flex.policy.triggers`, `flex.hitl.requests`, `flex.hitl.resolved`, `flex.validation.retries`, `flex.run.status{status=completed|awaiting_hitl|failed|cancelled}`.
  - Histogram: `flex.node.duration_ms{capabilityId}` measures per-node runtime.
- **In-memory stream**: `TelemetryService.subscribeToLifecycle` exposes planner + policy events for future dashboard consumers without touching SSE clients.
- **Dashboard guidance**: update Grafana panels to use the new `planVersion` field for flex runs, surface `facetProvenance.output[].facet` in node troubleshooting tables, and add alerts on `flex.run.status{status=failed}` using the counters above.
