# Security & Compliance
- MVP runs in a dev-only environment with no external users; bearer auth is NOT enforced yet (intentionally). Feature flag gating defaults to disabled to fail safe, aside from the new config suggestion endpoint which enforces operator auth and rate limiting from day one.
- Ingestion respects robots exclusion: adapters check for HTTP status codes and the `X-Discovery-Allow` header override to stay compliant.
- Stored raw payloads remain in `raw_payload_json` but are not exposed to frontend; only normalized summaries reach the dashboard.
- Add API throttling at the Nitro layer (per-IP/per-client limits) before exposing endpoints broadly.
