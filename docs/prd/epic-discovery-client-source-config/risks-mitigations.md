# Risks & Mitigations
- Invalid URLs or unsupported feeds slipping through → enforce server-side validation, try-feed discovery, and scheduled health checks.
- Configuration thrash causing ingestion instability → queue changes and apply with idempotent updates plus per-source rate-limit defaults.
