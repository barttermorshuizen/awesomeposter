# Discovery Agent Backend Architecture

## Context & Reuse
The discovery agent rides on the same Nitro + Agents Server stack that already powers AwesomePoster. We stay inside the monorepo, keeping a single Postgres database (`packages/db`), the Nitropack API (`server/`), and the OpenAI Agents orchestrator (`packages/agents-server`). Existing utilities—Drizzle migrations, shared type contracts, SSE envelopes, feature flag helpers, and logging—are reused wholesale. New work is limited to additive tables, endpoints, and orchestrator capabilities required by the six discovery epics.

## Change Log
| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2025-03-30 | v0.1 | Initial backend architecture plan for discovery agent MVP. | Winston (Architect) |

## High-Level Architecture
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

## Responsibilities by Layer
### Nitro API (`server/`)
- **`/api/discovery/sources`** (GET/POST/PATCH/DELETE) extends existing controller pattern (see `server/api/clients`). Uses shared Zod validators housed at `packages/shared/src/schemas/discovery.ts` to enforce URL canonicalization and keyword dedupe. Responses mirror the structures consumed by the frontend Pinia stores.
- **`/api/discovery/briefs`** exposes list/detail actions for reviewer workflow. It reads from the new `discovery_items` table and surfaces scoring metadata (`score`, `rationale`, duplicate cluster). Promote/archive operations call shared command helpers that update status plus append audit notes.
- **`/api/discovery/events.stream`** is a Nitro SSE handler built the same way as `/api/hitl/pending` fallback: it wraps `eventHandler` + `sendStream` to push telemetry frames published on a Node `EventEmitter`. Nitro already runs in long-lived mode so no infra change is needed.
- **Feature flags**: reuse `requireDiscoveryEnabled(event)` middleware that mirrors the `requireHitlEnabled` helper—flag values come from `packages/shared/src/config.ts` and environment variables populated at bootstrap.

### Scheduled Jobs (`server/jobs/discovery/*`)
- **`ingest-sources.ts`** is a Nitropack job triggered via our existing `npm run dev:api` scheduler hook (use `nitro-cron` in production). It batches per-client source lists, fetches feeds with `node-fetch`, and normalizes to our in-house schema using adapters in `packages/shared/src/discovery/ingestion.ts`.
- **`hydrate-health.ts`** (follow-up job) pings configured sources asynchronously and writes freshness/latency metrics into `discovery_sources.health_json`, enabling the UI health badges without a new service.
- Jobs enqueue “needs scoring” items by inserting into `discovery_items` with status `pending_scoring`; the agents server polls this table via the shared repository.

### Agents Server (`packages/agents-server`)
- **New capability: `DiscoveryScoringAgent`** lives under `src/agents/discovery-scoring.ts`. It reuses the existing OpenAI Agent runtime: register a tool that consumes normalized item payloads and emits score, rationale, topic tags, and dedupe signature. The orchestrator runs it as an asynchronous worker loop started alongside the existing app runner.
- **Duplicate detection** is handled in a deterministic TypeScript utility `calculateDedupHash` under `packages/shared`, but conflict resolution (merge vs. suppress) is orchestrated by an agent capability `DiscoveryDedupTool`. When the hash already exists, the agent records the relationship in `discovery_duplicates` and sets the item status to `suppressed`.
- **SSE telemetry**: rather than invent a new channel, the scoring loop emits `AgentEvent` frames through the existing `signalAgentEvent` helper. Nitro subscribers translate relevant frames into discovery SSE payloads for dashboard widgets.
- **Persistence adapters**: add `DiscoveryRepository` under `packages/agents-server/src/services/discovery-repository.ts`, built with Drizzle and the same connection factory as HITL (`createDbClient`). No new ORM tooling required.

## Data Model Additions
All tables are additive to `packages/db/src/schema.ts` and maintain foreign-key alignment with existing entities.

| Table | Purpose | Key Columns | Notes |
| --- | --- | --- | --- |
| `discovery_sources` | Canonical client inputs (URL, type, config) | `client_id`, `source_type`, `config_json`, `health_json`, `last_success_at` | Reuses `clients.id` FK. Stores feed metadata + validation result. |
| `discovery_keywords` | Keyword/tag lists per client | `client_id`, `keyword`, `is_active`, `added_by` | Unique constraint `(client_id, keyword_ci)` prevents duplicates. |
| `discovery_ingest_runs` | Log of ingestion sweeps | `id`, `client_id`, `started_at`, `finished_at`, `status`, `metrics_json` | Enables telemetry counters + retry gating. |
| `discovery_items` | Normalized nuggets ready for scoring | `id`, `client_id`, `source_id`, `raw_payload_json`, `normalized_json`, `status`, `ingested_at` | `status` enum: `pending_scoring`, `scored`, `suppressed`, `promoted`, `archived`. |
| `discovery_scores` | Agent output per item | `item_id`, `score`, `confidence`, `rationale_json`, `knobs_hint_json`, `scored_at` | Connected 1:1 with `discovery_items`. |
| `discovery_duplicates` | Cluster relationships | `item_id`, `duplicate_of_item_id`, `reason`, `confidence` | Maintains dedup chains without deleting source data. |
| `discovery_metrics` | Daily aggregates for telemetry cards | `client_id`, `metric_date`, `spotted_count`, `promoted_count`, `avg_score`, `duplicate_count` | Simple materialized view table refreshed nightly by Nitro job. |

No new databases or queues are required. For now we reuse Postgres as the durable store; if ingestion load spikes, we can revisit queueing but it is out of scope for MVP.

## API Contracts & Services
- **Validation**: extend `packages/shared/src/schemas.ts` with `DiscoverySourceSchema`, `DiscoveryItemResponse`, etc. Nitro handlers import these Zod schemas for both validation and type inference, mirroring existing `/api/clients` patterns.
- **Services**: add `server/utils/discovery-repository.ts` that exposes typed CRUD helpers using Drizzle. This keeps API files thin and matches the `hitlRepository` approach.
- **Bulk operations**: promotion/archival endpoints wrap a shared service that sets `discovery_items.status` and writes an audit entry to `discovery_metrics` for real-time updates.
- **SSE payload**: `packages/shared/src/discovery-events.ts` defines the envelope `{ type: 'brief-updated' | 'source-health' | 'metrics', payload, version }`—Nitro simply rehydrates DB rows and publishes via `eventHandler`. The frontend converts them with the new `subscribeDiscoveryEvents` helper already described in the UI document.

## Jobs, Scheduling, and Throughput
- **Triggering**: rely on Nitro’s built-in `crons` configuration (supported in `nitro.config.ts`) to run `discovery-ingest` every 30 minutes per enabled client. For local dev we reuse `npm run dev:api` watchers.
- **Backpressure**: ingestion job checks the count of `pending_scoring` items per client; if above a configurable threshold (default 500), it pauses pulling new content and raises a telemetry warning event so operators can react.
- **Retries**: store fetch errors in `discovery_ingest_runs.metrics_json`. A follow-up job `retry-failed-items.ts` requeues entries flagged as transient failures.
- **Scoring Loop**: the agents server polls `discovery_items` every few seconds using an indexed `status = 'pending_scoring'` query. It leverages the existing `withConcurrencyLimit` utility to keep parallel scoring runs under the same knob (defaults to 4) to manage token usage.

## Observability & Logging
- Nitro endpoints log via `useNitroLogger` wrapper already in place; add structured fields (`clientId`, `sourceId`, `itemId`).
- Agents server uses `getLogger().info` / `.error` with event names (`discovery.ingest.start`, `discovery.score.complete`). Since we reuse the Winston logger, logs pick up correlation IDs automatically when the scoring loop is triggered from API requests.
- Metrics: reuse the StatsD hooks defined for HITL once available. MVP focuses on Postgres aggregate tables and SSE updates; we avoid new telemetry infrastructure.
- Alerting: add a simple `pending_queue_threshold` check that emits a `warning` AgentEvent and surfaces in the UI when backlog size crosses configured limits.

## Security & Compliance
- MVP runs in a dev-only environment with no external users; bearer auth is NOT enforced yet (intentionally). Feature flag gating defaults to disabled to fail safe.
- Ingestion respects robots exclusion: adapters check for HTTP status codes and the `X-Discovery-Allow` header override to stay compliant.
- Stored raw payloads remain in `raw_payload_json` but are not exposed to frontend; only normalized summaries reach the dashboard.
- Add API throttling at the Nitro layer (per-IP/per-client limits) before exposing endpoints broadly.

## Testing Strategy
- **Unit**: new repositories and adapters get Vitest coverage under `packages/shared/__tests__/discovery` and `packages/agents-server/__tests__/discovery`. Use the existing in-memory Drizzle test harness.
- **Integration**: reuse the API integration test harness (see `tests/api/hitl.spec.ts`) to add `tests/api/discovery/*.spec.ts` covering flag gating, validation errors, and SSE handshake.
- **Load smoke**: a simple script under `scripts/discovery-seed.mjs` seeds 1k items and ensures scoring loop drains within expected time; run manually before pilot rollout.

## Decisions & Follow-ups
1. **Ingestion trigger scale**: stick with per-client scheduling for MVP; revisit per-source cron only if ingestion latency becomes an issue.
2. **External notifications**: no additional channels needed—SSE updates satisfy MVP requirements.
3. **Dedup retention**: keep full duplicate records but persist only source references (URLs). If table growth becomes problematic, plan a later task to prune or roll up counts.
