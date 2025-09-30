# 12. Risks & Mitigations
- **State divergence between orchestrator cache and DB**: Mitigate by making `HitlRepository.setRunState` the single writer and by integration tests covering resume/remove (Vitest + Drizzle test db).
- **UI drift from SSE contract**: Document event schema in `src/lib/agent-sse.ts` and add contract tests.
- **Operator latency leading to stale runs**: Introduce TTL warnings and optional auto-deny logic in future iteration.
- **Concurrency**: guard resume/remove with DB transactions (Drizzle) and status checks to avoid double-processing.
