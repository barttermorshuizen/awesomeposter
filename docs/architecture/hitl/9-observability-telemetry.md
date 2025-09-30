# 9. Observability & Telemetry
- Agents server logs (`getLogger().info`) already emit `hitl_request_created`, `hitl_request_denied`, `hitl_resume_api`, `hitl_cancel_api`. Ensure log fields include `runId`, `requestId`, `originAgent`, `operator.id`.
- Add metrics counters (e.g., StatsD) in `packages/agents-server/src/services/logger.ts` when available: `hitl.requests`, `hitl.responses`, `hitl.denied`.
- UI instrumentation: track operator actions via existing analytics hook (if available) to monitor response times.
- Alerting: dashboard on count of pending HITL requests older than SLA (e.g., 30 min) using `updatedAt` timestamps.
- Post-MVP checkpoint: schedule a weekly review of `hitl_pending_total`, breach count for 10-minute pending requests, resume/remove latency, and operator response times; log findings in the runbook and adjust thresholds before expanding beyond dev.
