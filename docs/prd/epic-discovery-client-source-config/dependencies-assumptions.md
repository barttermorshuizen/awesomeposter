# Dependencies & Assumptions
- Reuses existing auth/session management to identify client context.
- Persists to shared datastore modeled alongside briefs with source-type metadata.
- Ingestion service consumes configuration instantly or on next scheduled run, selecting the appropriate fetch adapter.
