# Observability & Logging
- Nitro endpoints log via `useNitroLogger` wrapper already in place; add structured fields (`clientId`, `sourceId`, `itemId`).
- Agents server uses `getLogger().info` / `.error` with event names (`discovery.ingest.start`, `discovery.score.complete`). Since we reuse the Winston logger, logs pick up correlation IDs automatically when the scoring loop is triggered from API requests.
- Metrics: reuse the StatsD hooks defined for HITL once available. MVP focuses on Postgres aggregate tables and SSE updates; we avoid new telemetry infrastructure.
- Alerting: add a simple `pending_queue_threshold` check that emits a `warning` AgentEvent and surfaces in the UI when backlog size crosses configured limits.
