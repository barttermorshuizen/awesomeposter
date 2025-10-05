# Discovery Agent Backend Architecture

## Context & Reuse
The discovery agent rides on the same Nitro + Agents Server stack that already powers AwesomePoster. We stay inside the monorepo, keeping a single Postgres database (`packages/db`), the Nitropack API (`server/`), and the OpenAI Agents orchestrator (`packages/agents-server`). Existing utilities—Drizzle migrations, shared type contracts, SSE envelopes, feature flag helpers, and logging—are reused wholesale. New work is limited to additive tables, endpoints, and orchestrator capabilities required by the six discovery epics.

## Change Log
| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2025-10-07 | v0.2 | Added configurable web list ingestion plan and configuration discovery API support. | Winston (Architect) |
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
- **`POST /api/discovery/config-suggestions`** accepts an authenticated payload with a target URL, fetches the DOM with `got`, runs selector heuristics, and returns a `webList` JSON snippet plus confidence metadata. It reuses shared Zod validation and wraps responses in the same envelope/error format as other discovery admin endpoints.
- **Feature flags**: reuse `requireDiscoveryEnabled(event)` middleware that mirrors the `requireHitlEnabled` helper—flag values come from `packages/shared/src/config.ts` and environment variables populated at bootstrap.

### Scheduled Jobs (`server/jobs/discovery/*`)
- **`ingest-sources.ts`** is a Nitropack job triggered via our existing `npm run dev:api` scheduler hook (use `nitro-cron` in production). It batches per-client source lists, fetches feeds with `node-fetch`, and normalizes to our in-house schema using adapters in `packages/shared/src/discovery/ingestion.ts`. When a source carries a `webList` block the job hydrates it alongside other config, iterates list containers/items, and maps configured fields before handing normalized payloads to the scoring queue.
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

### Configuration Schema & Storage
- Extend `packages/shared/src/discovery-config.ts` with an optional `webList` object containing selectors (`list_container_selector`, `item_selector`), a `fields` map for `title`/`excerpt`/`url`/`timestamp`, and a `pagination` descriptor (`next_page` selector plus attribute hints).
- Persist `webList` inside the existing `discovery_sources.config_json` payload so no new tables are introduced. Configuration helpers (`loadDiscoverySourceConfig`) must default absent fields to the current single-item heuristics to preserve backward compatibility.
- Validation lives in shared Zod schemas to guarantee that both API writes and ingestion jobs see consistent requirements (all selectors required once `webList` is present, optional pagination with max depth defaults).

## API Contracts & Services
- **Validation**: extend `packages/shared/src/schemas.ts` with `DiscoverySourceSchema`, `DiscoveryItemResponse`, etc. Nitro handlers import these Zod schemas for both validation and type inference, mirroring existing `/api/clients` patterns. The schema includes the optional `webList` block with selector requirements enforced when provided.
- **Services**: add `server/utils/discovery-repository.ts` that exposes typed CRUD helpers using Drizzle. This keeps API files thin and matches the `hitlRepository` approach.
- **Bulk operations**: promotion/archival endpoints wrap a shared service that sets `discovery_items.status` and writes an audit entry to `discovery_metrics` for real-time updates.
- **SSE payload**: `packages/shared/src/discovery-events.ts` defines the envelope `{ type: 'brief-updated' | 'source-health' | 'metrics', payload, version }`—Nitro simply rehydrates DB rows and publishes via `eventHandler`. The frontend converts them with the new `subscribeDiscoveryEvents` helper already described in the UI document.
- **Configuration discovery service**: `server/services/discovery-config-suggestions.ts` encapsulates DOM fetching, selector heuristics, confidence scoring, and schema validation before returning results to the new API endpoint. This isolates parsing complexity from the route handler and keeps it reusable for future UI tooling.

## Jobs, Scheduling, and Throughput
- **Triggering**: rely on Nitro’s built-in `crons` configuration (supported in `nitro.config.ts`) to run `discovery-ingest` every 30 minutes per enabled client. For local dev we reuse `npm run dev:api` watchers.
- **Backpressure**: ingestion job checks the count of `pending_scoring` items per client; if above a configurable threshold (default 500), it pauses pulling new content and raises a telemetry warning event so operators can react.
- **Retries**: store fetch errors in `discovery_ingest_runs.metrics_json`. A follow-up job `retry-failed-items.ts` requeues entries flagged as transient failures.
- **Scoring Loop**: the agents server polls `discovery_items` every few seconds using an indexed `status = 'pending_scoring'` query. It leverages the existing `withConcurrencyLimit` utility to keep parallel scoring runs under the same knob (defaults to 4) to manage token usage.
- **Telemetry**: ingestion metrics track list awareness (`webListApplied`, `listItemCount`, `paginationDepth`) and flow into both `discovery_ingest_runs.metrics_json` and AgentEvent SSE frames so operators can troubleshoot selector efficacy without SQL access.


### Ingestion Pipeline
- **Adapter matrix**: `server/jobs/discovery/ingest-sources.ts` calls adapter helpers defined under `packages/shared/src/discovery/ingestion.ts` and typed by `NormalizedDiscoveryItem` in `packages/shared/src/discovery.ts`.
  - HTTP/JSON sources map to `adapters/http.ts`, which performs `GET` requests with shared headers, throttles by tenant, and validates body schemas before handing normalized payloads back to the orchestrator.
  - RSS/Atom feeds use `adapters/rss.ts` (driven by `feedparser-promised`) to unwrap entries, canonicalize permalinks, and collapse duplicates by GUID + published timestamp.
  - YouTube playlists and channels leverage `adapters/youtube.ts`, preferring the official Data API when credentials exist and falling back to the RSS facade; both normalize into the same shape while capturing `videoId`, `channelId`, and duration metadata.
- **Normalization contract**: every adapter returns `{ rawPayload, normalized, sourceMetadata }`; the job records the raw payload in `discovery_items.raw_payload_json`, stores the normalized summary in `normalized_json`, and logs adapter metrics/errors into `discovery_ingest_runs.metrics_json` for observability. Rejections bubble an `ingest.error` event before the item is skipped.
- **List extraction mode**: when `webList` is configured the adapter uses the provided container/item selectors, applies configured field mappings with graceful fallbacks to legacy heuristics, and emits one normalized payload per discovered article. Pagination follows the configured `next_page` selector up to a safety ceiling (default 5 pages) while deduplicating URLs to avoid loops.
- **Worker pool configuration**: ingestion runs per-client batches with `MAX_CONCURRENT_FETCHES` (default 3) enforced inside the job via `p-limit`. Cron cadence (30 minutes) is adjustable per client flag, and a circuit breaker pauses HTTP fetches when `pending_scoring` exceeds the configured backlog threshold. The scoring side retains `withConcurrencyLimit(4)`; these two knobs are tuned together so the queue drains within one cycle without starving other Nitro jobs.


## Observability & Logging
- Nitro endpoints log via `useNitroLogger` wrapper already in place; add structured fields (`clientId`, `sourceId`, `itemId`).
- Agents server uses `getLogger().info` / `.error` with event names (`discovery.ingest.start`, `discovery.score.complete`). Since we reuse the Winston logger, logs pick up correlation IDs automatically when the scoring loop is triggered from API requests.
- Metrics: reuse the StatsD hooks defined for HITL once available. MVP focuses on Postgres aggregate tables and SSE updates; we avoid new telemetry infrastructure. New counters capture list extraction throughput (items per page, pagination depth) and suggestion API usage (success vs. low-confidence responses) for trend tracking.
- Alerting: add a simple `pending_queue_threshold` check that emits a `warning` AgentEvent and surfaces in the UI when backlog size crosses configured limits.

## Configuration Discovery API
- **Route handler**: `server/api/discovery/config-suggestions.post.ts` wires auth middleware, request validation, the configuration discovery service, and response shaping. Errors surface via the standard `{ error: { code, message, details } }` contract already used in admin endpoints.
- **Heuristics**: a pluggable selector engine inspects DOM structure (list containers, repeated anchors/headings) and scores candidates. Conflicting candidates return as an array of suggestions ordered by confidence, enabling UI selection.
- **Caching & timeouts**: requests enforce a tight timeout (default 8 seconds) and reuse Nitro’s fetch cache for repeat URLs within a short TTL to avoid hammering upstream sites. Results are never persisted; the endpoint is advisory only.
- **Consumers**: UI workflows fetch suggestions, show operator warnings, and let users copy the `webList` block directly into source configuration forms.

## Security & Compliance
- MVP runs in a dev-only environment with no external users; bearer auth is NOT enforced yet (intentionally). Feature flag gating defaults to disabled to fail safe, aside from the new config suggestion endpoint which enforces operator auth and rate limiting from day one.
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
