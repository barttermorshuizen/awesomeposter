# High-Level Architecture
```
                           ┌────────────────────────────────────────────┐
                           │ Nitro API (server/)                        │
                           │ • /api/discovery/sources                   │
                           │ • /api/discovery/briefs                    │
Client Operators ─────────▶│ • /api/discovery/events.stream (SSE)       │◀───────── Telemetry widgets
                           │ • /api/discovery/flags                     │
                           └──────────────▲─────────────────────────────┘
                                          │ uses Drizzle repo adapters
                                          │
                           ┌──────────────┴─────────────────────────────┐
                           │ packages/db (Postgres)                     │
                           │ • discovery_sources, discovery_keywords    │
                           │ • discovery_ingest_runs, discovery_items   │
                           │ • discovery_scores, discovery_duplicates   │
                           │ • discovery_metrics (aggregates)           │
                           └──────────────▲─────────────────────────────┘
                                          │ change feed / polling
                                          │
      Scheduled Jobs (Nitro)              │           Orchestrator Workers
┌──────────────────────────────┐          │          ┌──────────────────────────────┐
│ /jobs/discovery/ingest       │──────────┘          │ packages/agents-server        │
│ • fetch + normalize sources  │                     │ • DiscoveryScoringAgent       │
│ • enqueue scoring candidates │                     │ • DuplicateResolver capability│
└──────────────────────────────┘                     │ • Emits AgentEvent telemetry  │
                                                     └──────────────▲──────────────┘
                                                                    │
                                                Shared Contracts    │ SSE (AgentEvent)
                         ┌──────────────────────────────────────────┴──────────────────┐
                         │ packages/shared                           │
                         │ • discovery schemas, feature flags        │
                         │ • SSE envelopes (AgentEvent / Discovery)  │
                         └────────────────────────────────────────────┘
```
