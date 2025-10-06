# Responsibilities by Layer
## Nitro API (`server/`)
- **`/api/discovery/sources`** (GET/POST/PATCH/DELETE) extends existing controller pattern (see `server/api/clients`). Uses shared Zod validators housed at `packages/shared/src/schemas/discovery.ts` to enforce URL canonicalization and keyword dedupe. Responses mirror the structures consumed by the frontend Pinia stores.
- **`/api/discovery/briefs`** exposes list/detail actions for reviewer workflow. It reads from the new `discovery_items` table and surfaces scoring metadata (`score`, `rationale`, duplicate cluster). Promote/archive operations call shared command helpers that update status plus append audit notes.
- **`/api/discovery/events.stream`** is a Nitro SSE handler built the same way as `/api/hitl/pending` fallback: it wraps `eventHandler` + `sendStream` to push telemetry frames published on a Node `EventEmitter`. Nitro already runs in long-lived mode so no infra change is needed.
- **`POST /api/discovery/config-suggestions`** accepts an authenticated payload with a target URL, fetches the DOM with `got`, runs selector heuristics, and returns a `webList` JSON snippet plus confidence metadata. It reuses shared Zod validation and wraps responses in the same envelope/error format as other discovery admin endpoints.
- **Feature flags**: reuse `requireDiscoveryEnabled(event)` middleware that mirrors the `requireHitlEnabled` helper—flag values come from `packages/shared/src/config.ts` and environment variables populated at bootstrap.

## Scheduled Jobs (`server/jobs/discovery/*`)
- **`ingest-sources.ts`** is a Nitropack job triggered via our existing `npm run dev:api` scheduler hook (use `nitro-cron` in production). It batches per-client source lists, fetches feeds with `node-fetch`, normalizes to our in-house schema using adapters in `packages/shared/src/discovery/ingestion.ts`, then calls the synchronous scoring + dedup helpers before persisting. When a source carries a `webList` block the job hydrates it alongside other config, iterates list containers/items, maps configured fields, runs dedup/scoring in-process, and commits the transaction.
- **`hydrate-health.ts`** (follow-up job) pings configured sources asynchronously and writes freshness/latency metrics into `discovery_sources.health_json`, enabling the UI health badges without a new service.

## Processing Modules
- **Synchronous scoring helpers** live beside normalization (`packages/shared/src/discovery`). `scoreDiscoveryItem` accepts normalized payloads and returns score, rationale, topic tags, and a dedupe signature. The ingestion job calls this function inline—no orchestrator loop is required.
- **Deterministic dedup** uses a shared utility (`calculateDiscoveryFingerprint`) invoked during ingestion before the database write. When a fingerprint collision occurs we upsert `discovery_duplicates` and set the item status to `suppressed` within the same transaction.
- **Lifecycle orchestration** happens in `server/utils/discovery-repository.ts`, which wraps persistence in a unit of work that writes `discovery_items`, `discovery_scores`, and metrics together before committing so scoring and dedup stay coupled to ingestion success.
- **Telemetry emission** continues to flow through `emitDiscoveryEvent`, but frames are produced directly from ingestion once the transaction commits, eliminating the previous agent event relay.
