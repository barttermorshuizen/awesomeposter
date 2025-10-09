# Discovery Backend Architecture

## Context & Reuse
Discovery rides on the same Nitro + server runtime that already powers AwesomePoster. We stay inside the monorepo, keeping a single Postgres database (`packages/db`), the Nitropack API (`server/`), and the processing utilities under `packages/shared`. Existing utilities—Drizzle migrations, shared type contracts, SSE envelopes, feature flag helpers, and logging—are reused wholesale. New work is limited to additive tables, endpoints, and synchronous processing helpers required by the six discovery epics.

> **Terminology note**: earlier drafts referred to a “discovery agent”, but the scoring and dedup logic now run as deterministic functions invoked during ingestion. There is no separate agent runtime or queue; everything executes inline with the ingestion lifecycle alongside normalization.

## Change Log
| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2025-10-06 | v0.3 | Reframed discovery scoring/dedup as synchronous ingestion helpers; removed standalone agent loop. | Winston (Architect) |
| 2025-10-07 | v0.2 | Added configurable web list ingestion plan and configuration discovery API support. | Winston (Architect) |
| 2025-03-30 | v0.1 | Initial backend architecture plan for discovery MVP. | Winston (Architect) |

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

## Responsibilities by Layer
### Nitro API (`server/`)
- **`/api/discovery/sources`** (GET/POST/PATCH/DELETE) extends existing controller pattern (see `server/api/clients`). Uses shared Zod validators housed at `packages/shared/src/schemas/discovery.ts` to enforce URL canonicalization and keyword dedupe. Responses mirror the structures consumed by the frontend Pinia stores.
- **`/api/discovery/briefs`** exposes list/detail actions for reviewer workflow. It reads from the new `discovery_items` table and surfaces scoring metadata (`score`, `rationale`, duplicate cluster). Promote/archive operations call shared command helpers that update status plus append audit notes.
- **`/api/discovery/events.stream`** is a Nitro SSE handler built the same way as `/api/hitl/pending` fallback: it wraps `eventHandler` + `sendStream` to push telemetry frames published on a Node `EventEmitter`. Nitro already runs in long-lived mode so no infra change is needed.
- **`POST /api/discovery/config-suggestions`** accepts an authenticated payload with a target URL, fetches the DOM with `got`, runs selector heuristics, and returns a `webList` JSON snippet plus confidence metadata. It reuses shared Zod validation and wraps responses in the same envelope/error format as other discovery admin endpoints.
- **Feature flags**: reuse `requireDiscoveryEnabled(event)` middleware that mirrors the `requireHitlEnabled` helper—flag values come from `packages/shared/src/config.ts` and environment variables populated at bootstrap.
- **`GET /api/discovery/search`** (Story 5.5) provides list/filter data for the dashboard. It accepts arrays for `sourceIds`, `topics`, and `status`, optional `dateFrom`/`dateTo`, pagination (`page`, `pageSize` limited to 25/50/100), and `searchTerm`. Validation lives in shared Zod schemas so the SPA can reuse types. Queries hit `discovery_items` via compound index `(client_id, status, score DESC, created_at DESC)` combined with full-text search (tsvector) for highlight snippets. Responses include `{ items, total, page, pageSize, latencyMs }` where each item exposes `{ highlights: [{ field, snippets[] }], score, createdAt }`. Cursor-based pagination (score + id) prevents duplicates when new items land mid-query. Handler emits telemetry `discovery.search.requested`/`completed` events for latency dashboards and toggles SSE degrade flags consumed by Story 5.1.

### Discovery Search Endpoint Details

- **Validation & Schema Sharing**: `packages/shared/src/discovery/search.ts` exports the Zod filters/response schemas used by both Nitro and the Vue service module. Query coercion trims multi-value parameters (`status`, `sources`, `topics`) and enforces allowed page sizes (25/50/100).
- **Query Plan**: Search uses `discovery_items` joined to `discovery_scores`, filtering by client, status aliases (`spotted`→`scored`, `approved`→`promoted`), optional source/topic/date constraints, and full-text search (`websearch_to_tsquery`) across the title, excerpt, and extracted body. Ordering is deterministic: text rank (when searching) → score (NULLS -> 0) → `ingested_at DESC` → `id DESC` so new inserts do not reshuffle previously fetched pages.
- **Indexes**: Migration `20250405_add_discovery_search_indexes.sql` adds:
  - `discovery_items_client_status_ingested_idx` for client+status pagination.
  - `discovery_items_client_source_ingested_idx` to accelerate source filters.
  - `discovery_items_client_published_idx` to support date range filtering.
  - `discovery_items_search_vector_idx` (GIN) on normalized excerpt/body + title for full-text search and highlighting.
- **Highlighting**: `ts_headline` produces fragments for title/excerpt/body with sentinel markers that are HTML-escaped server-side before swapping back to `<mark>…</mark>`. Only ASCII-safe snippets ship to the SPA, guarding against XSS while still enabling rich display.
- **Telemetry & Degrade Signals**: The handler emits `discovery.search.requested` before running and `discovery.search.completed` after execution. The completion payload includes `latencyMs`, `returned`, `total`, and `degraded` flags. Degrade is triggered when latency breaches 400 ms P95 or total results exceed 1,000; the SPA reacts by enabling virtualization + periodic polling fallbacks (Story 5.1). Events propagate through the existing SSE channel for live dashboards.
- **Operational Guidance**: `scripts/discovery-search-benchmark.mjs` seeds a 1k-item dataset and hammers the endpoint at 50 RPS to verify the 400 ms P95 budget. Baseline metrics and rollback instructions live in `docs/qa/perf/discovery-filters.md`.

### Scheduled Jobs (`server/jobs/discovery/*`)
- **`ingest-sources.ts`** is a Nitropack job triggered via our existing `npm run dev:api` scheduler hook (use `nitro-cron` in production). It batches per-client source lists, fetches feeds with `node-fetch`, normalizes to our in-house schema using adapters in `packages/shared/src/discovery/ingestion.ts`, then calls the synchronous scoring + dedup helpers before persisting. When a source carries a `webList` block the job hydrates it alongside other config, iterates list containers/items, maps configured fields, runs dedup/scoring in-process, and commits the transaction.
- **`hydrate-health.ts`** (follow-up job) pings configured sources asynchronously and writes freshness/latency metrics into `discovery_sources.health_json`, enabling the UI health badges without a new service.

### Processing Modules
- **Synchronous scoring helpers** live beside normalization (`packages/shared/src/discovery`). `scoreDiscoveryItem` accepts normalized payloads and returns score, rationale, topic tags, and a dedupe signature. The ingestion job calls this function inline—no orchestrator loop is required.
- **Deterministic dedup** uses a shared utility (`calculateDiscoveryFingerprint`) invoked during ingestion before the database write. When a fingerprint collision occurs we upsert `discovery_duplicates` and set the item status to `suppressed` within the same transaction.
- **Lifecycle orchestration** happens in `server/utils/discovery-repository.ts`, which wraps persistence in a unit of work that writes `discovery_items`, `discovery_scores`, and metrics together before committing so scoring and dedup stay coupled to ingestion success.
- **Telemetry emission** continues to flow through `emitDiscoveryEvent`, but frames are produced directly from ingestion once the transaction commits, eliminating the previous agent event relay.

## Data Model Additions
All tables are additive to `packages/db/src/schema.ts` and maintain foreign-key alignment with existing entities.

| Table | Purpose | Key Columns | Notes |
| --- | --- | --- | --- |
| `discovery_sources` | Canonical client inputs (URL, type, config) | `client_id`, `source_type`, `config_json`, `health_json`, `last_success_at` | Reuses `clients.id` FK. Stores feed metadata + validation result. |
| `discovery_keywords` | Keyword/tag lists per client | `client_id`, `keyword`, `is_active`, `added_by` | Unique constraint `(client_id, keyword_ci)` prevents duplicates. |
| `discovery_ingest_runs` | Log of ingestion sweeps | `id`, `client_id`, `started_at`, `finished_at`, `status`, `metrics_json` | Enables telemetry counters + retry gating. |
| `discovery_items` | Normalized nuggets ready for review | `id`, `client_id`, `source_id`, `raw_payload_json`, `normalized_json`, `status`, `ingested_at` | `status` enum: `scored`, `suppressed`, `promoted`, `archived`. Default `scored`; ingestion sets `suppressed` during the same transaction when dedup hits. |
| `discovery_scores` | Scoring output per item | `item_id`, `score`, `confidence`, `rationale_json`, `knobs_hint_json`, `scored_at` | Connected 1:1 with `discovery_items`; written in the same transaction as the parent item. |
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
- **Backpressure**: ingestion inspects the volume of unreviewed `scored` items per client (default ceiling 500). When the threshold is exceeded it pauses new fetches, logs a structured warning, and emits a discovery backlog SSE frame so operators can react before reviewers are overwhelmed.
- **Retries**: store fetch errors in `discovery_ingest_runs.metrics_json`. A follow-up job `retry-failed-items.ts` requeues entries flagged as transient failures.
- **Inline scoring**: scoring and dedup run in the same worker pool as normalization. We reuse `withConcurrencyLimit` inside the ingestion job (defaults to 4 parallel item processors) to bound CPU/token usage without a secondary loop.
- **Telemetry**: ingestion metrics track list awareness (`webListApplied`, `listItemCount`, `paginationDepth`) and flow into both `discovery_ingest_runs.metrics_json` and discovery SSE frames so operators can troubleshoot selector efficacy without SQL access.


### Ingestion Pipeline
- **Adapter matrix**: `server/jobs/discovery/ingest-sources.ts` calls adapter helpers defined under `packages/shared/src/discovery/ingestion.ts` and typed by `NormalizedDiscoveryItem` in `packages/shared/src/discovery.ts`.
  - HTTP/JSON sources map to `adapters/http.ts`, which performs `GET` requests with shared headers, throttles by tenant, and validates body schemas before handing normalized payloads into the synchronous processing pipeline.
  - RSS/Atom feeds use `adapters/rss.ts` (driven by `feedparser-promised`) to unwrap entries, canonicalize permalinks, and collapse duplicates by GUID + published timestamp before they hit scoring/dedup.
  - YouTube playlists and channels leverage `adapters/youtube.ts`, preferring the official Data API when credentials exist and falling back to the RSS facade; both normalize into the same shape while capturing `videoId`, `channelId`, and duration metadata for the downstream scoring helpers.
- **Normalization contract**: every adapter returns `{ rawPayload, normalized, sourceMetadata }`; the job records the raw payload in `discovery_items.raw_payload_json`, stores the normalized summary in `normalized_json`, runs scoring + dedup on the normalized payload, and logs adapter metrics/errors into `discovery_ingest_runs.metrics_json` for observability. Rejections bubble an `ingest.error` event before the item is skipped.
- **List extraction mode**: when `webList` is configured the adapter uses the provided container/item selectors, applies configured field mappings with graceful fallbacks to legacy heuristics, and emits one normalized payload per discovered article. Pagination follows the configured `next_page` selector up to a safety ceiling (default 5 pages) while deduplicating URLs to avoid loops.
- **Worker pool configuration**: ingestion runs per-client batches with `MAX_CONCURRENT_FETCHES` (default 3) enforced inside the job via `p-limit`. Cron cadence (30 minutes) is adjustable per client flag, and the backlog guard now keyes off unreviewed `scored` items instead of a separate queue to keep throughput predictable.


## Observability & Logging
- Nitro endpoints log via `useNitroLogger` wrapper already in place; add structured fields (`clientId`, `sourceId`, `itemId`).
- Ingestion workers share the Winston logger and emit lifecycle markers (`discovery.ingest.start`, `discovery.ingest.scored`, `discovery.ingest.suppressed`) as they process each batch. Because scoring happens inline the correlation ID flows naturally from the job context.
- Metrics: reuse the StatsD hooks defined for HITL once available. MVP focuses on Postgres aggregate tables and SSE updates; we avoid new telemetry infrastructure. New counters capture list extraction throughput (items per page, pagination depth), suggestion API usage (success vs. low-confidence responses), and synchronous scoring latency.
- Alerting: add a `backlog_threshold` guard that emits a `warning` discovery SSE frame when unreviewed scored items exceed limits so operators can react without polling the database.

## Configuration Discovery API
- **Route handler**: `server/api/discovery/config-suggestions.post.ts` wires auth middleware, request validation, the configuration discovery service, and response shaping. Errors surface via the standard `{ error: { code, message, details } }` contract already used in admin endpoints.
- **Heuristics**: a pluggable selector engine inspects DOM structure (list containers, repeated anchors/headings) and scores candidates. Conflicting candidates return as an array of suggestions ordered by confidence, enabling UI selection.
- **Caching & timeouts**: requests enforce a tight timeout (default 8 seconds) and reuse Nitro’s fetch cache for repeat URLs within a short TTL to avoid hammering upstream sites. Results are never persisted; the endpoint is advisory only.
- **Consumers**: UI workflows fetch suggestions, show operator warnings, and let users copy the `webList` block directly into source configuration forms.

## Web List Configuration Contract
- **Schema location**: `packages/shared/src/discovery/config.ts` defines the canonical Zod schemas consumed by both the Nitro API and ingestion jobs. The block lives inside `discovery_sources.config_json` under the `webList` key.
- **Required selectors**: `list_container_selector` and `item_selector` are required whenever the block is present. Field mappings (`fields.title`, `fields.url`, `fields.excerpt`, `fields.timestamp`) accept either a raw selector string or `{ selector, attribute?, valueTemplate? }`. Pagination uses `pagination.next_page` with an optional attribute hint; `max_depth` defaults to **5**.
- **Serialization**: helpers expose `parseDiscoverySourceConfig`/`serializeDiscoverySourceConfig` so Nitro handlers can validate payloads, normalize casing, and persist camelCase-friendly data while the database retains snake_case keys.
- **Telemetry**: ingestion runs now record `webListConfigured`, `webListApplied`, `listItemCount`, and `paginationDepth` inside `discovery_ingest_runs.metrics_json`, ensuring SSE events report whether list rules were applied.
- **Sample**: `docs/architecture/discovery_agent_backend/samples/web-list-config.json` shows a multi-page configuration with title/url selectors, timestamp extraction, and pagination hints for operators to reference.

## Security & Compliance
- MVP runs in a dev-only environment with no external users; bearer auth is NOT enforced yet (intentionally). Feature flag gating defaults to disabled to fail safe, aside from the new config suggestion endpoint which enforces operator auth and rate limiting from day one.
- Ingestion respects robots exclusion: adapters check for HTTP status codes and the `X-Discovery-Allow` header override to stay compliant.
- Stored raw payloads remain in `raw_payload_json` but are not exposed to frontend; only normalized summaries reach the dashboard.
- Add API throttling at the Nitro layer (per-IP/per-client limits) before exposing endpoints broadly.

## Testing Strategy
- **Unit**: new repositories and adapters get Vitest coverage under `packages/shared/__tests__/discovery` and `packages/agents-server/__tests__/discovery`. Use the existing in-memory Drizzle test harness.
- **Integration**: reuse the API integration test harness (see `tests/api/hitl.spec.ts`) to add `tests/api/discovery/*.spec.ts` covering flag gating, validation errors, and SSE handshake.
- **Load smoke**: a simple script under `scripts/discovery-seed.mjs` seeds 1k items and ensures the synchronous ingestion + scoring pipeline completes within expected time; run manually before pilot rollout.

## Decisions & Follow-ups
1. **Ingestion trigger scale**: stick with per-client scheduling for MVP; revisit per-source cron only if ingestion latency becomes an issue.
2. **External notifications**: no additional channels needed—SSE updates satisfy MVP requirements.
3. **Dedup retention**: keep full duplicate records but persist only source references (URLs). If table growth becomes problematic, plan a later task to prune or roll up counts.
