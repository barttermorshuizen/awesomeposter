# Functional Requirements
- Scheduler respects per-source cadence, selects appropriate adapters per source type, and avoids overlapping fetches for the same source.
- Normalization handles UTF-8 encoding, strips boilerplate, conforms RSS and YouTube payloads into shared fields, and records publication timestamp when available.
- Persist ingestion results with status flags (success, transient failure, permanent failure) and include source-type metadata for downstream scoring.
- Expose ingestion status to telemetry and SSE events for UI visibility, including rate-limit and provider error details.
