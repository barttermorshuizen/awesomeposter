# Scope (In)
- Scheduled jobs fetching HTTP web pages, RSS feeds, and YouTube channels/playlists per client configuration.
- Content extraction and normalization (title, source, timestamp, summary body/description, URL, raw text hash, source type metadata).
- Storage of normalized items with metadata linking back to source configuration and traction signals.
- Retry/backoff strategy for temporary failures; health status collection and rate-limit awareness.
