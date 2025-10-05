# Jobs, Scheduling, and Throughput
- **Triggering**: rely on Nitro’s built-in `crons` configuration (supported in `nitro.config.ts`) to run `discovery-ingest` every 30 minutes per enabled client. For local dev we reuse `npm run dev:api` watchers.
- **Backpressure**: ingestion job checks the count of `pending_scoring` items per client; if above a configurable threshold (default 500), it pauses pulling new content and raises a telemetry warning event so operators can react.
- **Retries**: store fetch errors in `discovery_ingest_runs.metrics_json`. A follow-up job `retry-failed-items.ts` requeues entries flagged as transient failures.
- **Scoring Loop**: the agents server polls `discovery_items` every few seconds using an indexed `status = 'pending_scoring'` query. It leverages the existing `withConcurrencyLimit` utility to keep parallel scoring runs under the same knob (defaults to 4) to manage token usage.
- **Telemetry**: ingestion metrics track list awareness (`webListApplied`, `listItemCount`, `paginationDepth`) and flow into both `discovery_ingest_runs.metrics_json` and AgentEvent SSE frames so operators can troubleshoot selector efficacy without SQL access.


## Ingestion Pipeline
- **Adapter matrix**: `server/jobs/discovery/ingest-sources.ts` calls adapter helpers defined under `packages/shared/src/discovery/ingestion.ts` and typed by `NormalizedDiscoveryItem` in `packages/shared/src/discovery.ts`.
  - HTTP/JSON sources map to `adapters/http.ts`, which performs `GET` requests with shared headers, throttles by tenant, and validates body schemas before handing normalized payloads back to the orchestrator.
  - RSS/Atom feeds use `adapters/rss.ts` (driven by `feedparser-promised`) to unwrap entries, canonicalize permalinks, and collapse duplicates by GUID + published timestamp.
  - YouTube playlists and channels leverage `adapters/youtube.ts`, preferring the official Data API when credentials exist and falling back to the RSS facade; both normalize into the same shape while capturing `videoId`, `channelId`, and duration metadata.
- **Normalization contract**: every adapter returns `{ rawPayload, normalized, sourceMetadata }`; the job records the raw payload in `discovery_items.raw_payload_json`, stores the normalized summary in `normalized_json`, and logs adapter metrics/errors into `discovery_ingest_runs.metrics_json` for observability. Rejections bubble an `ingest.error` event before the item is skipped.
- **List extraction mode**: when `webList` is configured the adapter uses the provided container/item selectors, applies configured field mappings with graceful fallbacks to legacy heuristics, and emits one normalized payload per discovered article. Pagination follows the configured `next_page` selector up to a safety ceiling (default 5 pages) while deduplicating URLs to avoid loops.
- **Worker pool configuration**: ingestion runs per-client batches with `MAX_CONCURRENT_FETCHES` (default 3) enforced inside the job via `p-limit`. Cron cadence (30 minutes) is adjustable per client flag, and a circuit breaker pauses HTTP fetches when `pending_scoring` exceeds the configured backlog threshold. The scoring side retains `withConcurrencyLimit(4)`; these two knobs are tuned together so the queue drains within one cycle without starving other Nitro jobs.

