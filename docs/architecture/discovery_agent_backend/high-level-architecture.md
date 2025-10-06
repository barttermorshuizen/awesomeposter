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
                                          │ ingest persistence & reads
                                          │
      Scheduled Jobs (Nitro)              │           Processing Utilities
┌──────────────────────────────┐          │          ┌──────────────────────────────┐
│ /jobs/discovery/ingest       │──────────┘          │ packages/shared + server/utils │
│ • fetch + normalize sources  │                     │ • normalizeDiscoveryItem       │
│ • score + deduplicate items  │                     │ • scoreDiscoveryItem           │
│ • emit SSE + persist metrics │                     │ • calculateDedupHash           │
└──────────────────────────────┘                     │ • emitDiscoveryEvent           │
                                                     └──────────────▲──────────────┘
                                                                    │
                                                Shared Contracts    │ SSE (Discovery event)
                         ┌──────────────────────────────────────────┴──────────────────┐
                         │ packages/shared                           │
                         │ • discovery schemas, feature flags        │
                         │ • SSE envelopes (discovery stream)        │
                         └────────────────────────────────────────────┘
```
