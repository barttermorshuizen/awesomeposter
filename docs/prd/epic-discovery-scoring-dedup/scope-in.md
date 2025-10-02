# Scope (In)
- Scoring model incorporating keyword match, recency decay, source weighting, and configurable traction signals (RSS activity, YouTube metrics, social/news mentions, duplicate density).
- Configurable thresholds per client; runtime adjustments through configuration service.
- Duplicate detection using URL hash, title similarity, and content fingerprinting that feeds traction metrics.
- Metadata tagging (score, component breakdown, duplicate status) persisted with each item.
