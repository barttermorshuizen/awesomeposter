# Testing Strategy
- **Unit**: new repositories and adapters get Vitest coverage under `packages/shared/__tests__/discovery` and `packages/agents-server/__tests__/discovery`. Use the existing in-memory Drizzle test harness.
- **Integration**: reuse the API integration test harness (see `tests/api/hitl.spec.ts`) to add `tests/api/discovery/*.spec.ts` covering flag gating, validation errors, and SSE handshake.
- **Load smoke**: a simple script under `scripts/discovery-seed.mjs` seeds 1k items and ensures scoring loop drains within expected time; run manually before pilot rollout.
