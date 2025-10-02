# Risks & Mitigations
- Threshold drift reducing accuracy → schedule periodic calibration reviews and maintain sandbox for testing.
- Duplicate logic missing near-identical content → combine multiple similarity checks and allow manual override flags.
- External traction providers exceeding rate limits or failing → use configurable rate limiter, caching, and graceful fallback to relevance-only scoring.
