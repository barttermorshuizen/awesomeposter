# Observability & Logging
- Nitro endpoints log via `useNitroLogger` wrapper already in place; add structured fields (`clientId`, `sourceId`, `itemId`).
- Ingestion workers share the Winston logger and emit lifecycle markers (`discovery.ingest.start`, `discovery.ingest.scored`, `discovery.ingest.suppressed`) as they process each batch. Because scoring happens inline the correlation ID flows naturally from the job context.
- Metrics: reuse the StatsD hooks defined for HITL once available. MVP focuses on Postgres aggregate tables and SSE updates; we avoid new telemetry infrastructure. New counters capture list extraction throughput (items per page), suggestion API usage (success vs. low-confidence responses), and synchronous scoring latency.
- Alerting: add a `backlog_threshold` guard that emits a `warning` discovery SSE frame when unreviewed scored items exceed limits so operators can react without polling the database.
