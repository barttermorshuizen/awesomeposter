# 13. Migration & Rollout Strategy
- Phase 0: clone repository package, share utilities via `packages/shared`, and stub the new endpoint returning mocked events for UI integration.
- Phase 1: implement planner, policy normalization, and dynamic bundling for the create-post use case; run dual writes to existing agents server for comparison.
- Phase 2: enable HITL + rehydration parity, then allow selected operator accounts to use the flex popup in production via feature flag.
- Phase 3: migrate additional workflows (brief creation, QA scoring) once parity confidence is high; plan eventual retirement of legacy orchestrator.
- Post-condition guard visualizations and telemetry counters stay behind `USE_FLEX_DEV_SANDBOX` until dashboards and operator runbooks confirm signal quality; keep disabled in production tenants until validation completes.
