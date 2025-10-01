# Epic: Ingestion & Normalization

## Epic Goal
Build a resilient ingestion pipeline that pulls configured sources on schedule, normalizes content into a shared schema, and prepares items for scoring.

## Problem Statement
- Without automated ingestion, marketing teams face manual copy/paste work and inconsistent coverage.
- Accuracy and freshness targets depend on timely, consistent pulls from client-approved sources.

## Objectives & Success Metrics
- Deliver normalized items to downstream services within hours of publication.
- Achieve >99% successful fetch rate for healthy sources; log failures for operator review.
- Maintain pipeline availability with MTTR < 1 hour for common transient failures.

## Scope (In)
- Scheduled jobs fetching HTTP web pages, RSS feeds, and YouTube channels/playlists per client configuration.
- Content extraction and normalization (title, source, timestamp, summary body/description, URL, raw text hash, source type metadata).
- Storage of normalized items with metadata linking back to source configuration and traction signals.
- Retry/backoff strategy for temporary failures; health status collection and rate-limit awareness.

## Scope (Out)
- Real-time streaming ingestion or push-based integrations.
- Manual upload interfaces.
- Complex content parsing (e.g., sentiment, topic classification) beyond baseline extraction.

## Functional Requirements
- Scheduler respects per-source cadence, selects appropriate adapters per source type, and avoids overlapping fetches for the same source.
- Normalization handles UTF-8 encoding, strips boilerplate, conforms RSS and YouTube payloads into shared fields, and records publication timestamp when available.
- Persist ingestion results with status flags (success, transient failure, permanent failure) and include source-type metadata for downstream scoring.
- Expose ingestion status to telemetry and SSE events for UI visibility, including rate-limit and provider error details.

## Non-Functional Requirements
- Pipeline must handle at least 100 sources per client without major latency increases.
- Robustness against flaky sources via exponential backoff and capped retries.
- Logging at each stage to support debugging and accuracy audits.

## Dependencies & Assumptions
- Depends on client configuration epic for source lists and source-type metadata.
- Utilizes existing datastore and background job infrastructure with pluggable fetch adapters.
- Access to HTTP content, RSS feeds, and YouTube APIs (indirect as needed) is permitted by client agreements.

## Risks & Mitigations
- Source blocking or API quotas due to aggressive crawling → respect robots.txt, YouTube quota, and configurable rate limits with caching/backoff.
- HTML/feed schema changes breaking extraction → modular extractor with graceful degradation and alerts.

## Definition of Done
- Configured sources ingest on schedule and produce normalized items ready for scoring.
- Telemetry shows health metrics and failure causes.
- Operational runbook documents on-call procedures for ingestion failures.
