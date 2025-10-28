# 9.1 Capability Registration Flow
1. Agent instance boots and gathers its metadata (capability ID, name, summary, supported locales/tones/formats, preferred models, facet coverage arrays, cost tier, health status).
2. Agent calls `POST /api/v1/flex/capabilities/register` with that payload and an auth token issued for agent services.
3. Orchestrator validates the payload, upserts the record in `flex_capabilities`, and emits an internal event so the in-memory `CapabilityRegistry` refreshes.
4. Periodic heartbeats (either repeated registrations or lightweight `PATCH` calls) keep availability status current; stale capabilities are marked `inactive` so the planner can fall back automatically.
5. When an agent shuts down gracefully, it deregisters (optional) so capacity metrics stay accurate.
