# Dependencies & Assumptions
- Consumes normalized items (with source-type metadata) from ingestion pipeline.
- Requires configuration service to expose source weights and traction toggles per client.
- Persists discovery items (including score metadata) to the shared datastore consumed by the review dashboard; briefs are only created once reviewers promote an item.
- Reviewers provide feedback separately to inform tuning.
