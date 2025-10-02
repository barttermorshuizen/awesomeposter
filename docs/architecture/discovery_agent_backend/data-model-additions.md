# Data Model Additions
All tables are additive to `packages/db/src/schema.ts` and maintain foreign-key alignment with existing entities.

| Table | Purpose | Key Columns | Notes |
| --- | --- | --- | --- |
| `discovery_sources` | Canonical client inputs (URL, type, config) | `client_id`, `source_type`, `config_json`, `health_json`, `last_success_at` | Reuses `clients.id` FK. Stores feed metadata + validation result. |
| `discovery_keywords` | Keyword/tag lists per client | `client_id`, `keyword`, `is_active`, `added_by` | Unique constraint `(client_id, keyword_ci)` prevents duplicates. |
| `discovery_ingest_runs` | Log of ingestion sweeps | `id`, `client_id`, `started_at`, `finished_at`, `status`, `metrics_json` | Enables telemetry counters + retry gating. |
| `discovery_items` | Normalized nuggets ready for scoring | `id`, `client_id`, `source_id`, `raw_payload_json`, `normalized_json`, `status`, `ingested_at` | `status` enum: `pending_scoring`, `scored`, `suppressed`, `promoted`, `archived`. |
| `discovery_scores` | Agent output per item | `item_id`, `score`, `confidence`, `rationale_json`, `knobs_hint_json`, `scored_at` | Connected 1:1 with `discovery_items`. |
| `discovery_duplicates` | Cluster relationships | `item_id`, `duplicate_of_item_id`, `reason`, `confidence` | Maintains dedup chains without deleting source data. |
| `discovery_metrics` | Daily aggregates for telemetry cards | `client_id`, `metric_date`, `spotted_count`, `promoted_count`, `avg_score`, `duplicate_count` | Simple materialized view table refreshed nightly by Nitro job. |

No new databases or queues are required. For now we reuse Postgres as the durable store; if ingestion load spikes, we can revisit queueing but it is out of scope for MVP.
