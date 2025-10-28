# 13. Verification
- `packages/shared/__tests__/flex/policies.spec.ts` validates the canonical runtime action union, nested HITL follow-ups, and legacy name guards.
- `packages/flex-agents-server/__tests__/flex-run-coordinator.spec.ts` covers goto retry limits, explicit fail actions, pause/resume snapshots, and HITL rejection defaults to prevent runtime regressions.
