# Jobs, Scheduling, and Throughput
- **Triggering**: rely on Nitro’s built-in `crons` configuration (supported in `nitro.config.ts`) to run `discovery-ingest` every 30 minutes per enabled client. For local dev we reuse `npm run dev:api` watchers.
- **Backpressure**: ingestion job checks the count of `pending_scoring` items per client; if above a configurable threshold (default 500), it pauses pulling new content and raises a telemetry warning event so operators can react.
- **Retries**: store fetch errors in `discovery_ingest_runs.metrics_json`. A follow-up job `retry-failed-items.ts` requeues entries flagged as transient failures.
- **Scoring Loop**: the agents server polls `discovery_items` every few seconds using an indexed `status = 'pending_scoring'` query. It leverages the existing `withConcurrencyLimit` utility to keep parallel scoring runs under the same knob (defaults to 4) to manage token usage.
