# 12. UI & Client Integration
- Introduce a feature-flagged “Create Post (Flex)” popup (gated via env var such as `USE_FLEX_AGENTS_POPUP`) that targets `/api/v1/flex/run.stream`, keeping legacy flows untouched.
- The popup constructs `TaskEnvelope`s from existing brief forms, plus any marketing persona defaults resolved by the SPA.
- SSE frames preserve the current envelope signature (`type`, `id`, `timestamp`, `payload`), so the existing `useHitlStore` wiring continues to parse events; only the event `type` values expand to cover new planner states (`FlexEvent` namespace).
- Upon HITL prompts, the UI redirects operators to the same approval modal, now carrying the node artifact contract so reviewers see exactly what is pending.
- The approval modal surfaces the orchestrator-authored operator guidance string and the serialized contract summary (capability label, plan version, facet provenance). Operators can review the pending node contract without additional lookups before approving or rejecting the run.
- The sandbox plan inspector validates streamed plan snapshots; payloads missing `status` or `version` now raise a blocking banner instructing operators to retry the resume. This guards against silent downgrades when upstream services regress resume contracts.
