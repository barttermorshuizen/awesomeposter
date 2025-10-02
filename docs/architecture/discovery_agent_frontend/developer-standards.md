# Developer Standards
- Keep stores lean and serialisable; avoid embedding DOM state (e.g., `HTMLElement`) inside Pinia.
- Co-locate mock JSON fixtures under `tests/discovery/fixtures/` to encourage deterministic tests.
- Gate all network calls behind services; components should never `fetch` directly.
- Every mutation endpoint must include the acting user + note, matching PRD requirements; surface validation feedback inline.
- Respect optimistic UI patterns but always reconcile with server truth on response (similar to HITL remove/resume flows).
- Document new SSE event types in `packages/shared/src/discovery-events.ts` with comments so backend/agents teams stay aligned.
