# Functional Requirements
- Source form accepts HTTP/HTTPS URLs only; reject other protocols with clear error messages.
- Detect RSS feeds and YouTube channel/playlist IDs, persist canonical source metadata, and surface type to downstream services.
- Deduplicate sources and keywords on save (including canonicalized RSS/YouTube identifiers); highlight conflicts inline.
- Provide status indicators for last successful fetch per source once ingestion runs.
- Configuration changes emit SSE events for the dashboard to refresh.
