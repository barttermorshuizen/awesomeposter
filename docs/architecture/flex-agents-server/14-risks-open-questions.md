# 14. Risks & Open Questions
- Planner correctness: dynamic graph generation increases complexity; we need strong telemetry and debug tooling to trace decisions.
- Policy conflicts: inconsistent caller-supplied directives (for example variant counts versus schema `minItems`) can break runs; conflict resolution rules must be explicit.
- Validation cost: Ajv on large schemas may slow runs; consider caching compiled schemas and streaming partial validation errors.
- Capability drift: registry metadata must stay synchronized with actual agent prompts to avoid mismatched expectations.
