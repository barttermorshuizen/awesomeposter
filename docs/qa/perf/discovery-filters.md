# Discovery Search API Perf Baseline

## Test Configuration
- **Dataset:** Seeded 1,200 discovery items across four sources using `node scripts/discovery-search-benchmark.mjs --seed --items 1200`.
- **Environment:** Local Postgres (Docker, 4 vCPUs, 8 GB RAM) with Nitro dev server (`npm run dev`) on Node 20.12.
- **Workload:** 50 RPS sustained for 30 seconds (`--rps 50 --duration 30`) against `GET /api/discovery/search?clientId=<pilot>&status=spotted&searchTerm=ai`.
- **Flags:** `discovery-agent` and `discovery.filters.v1` enabled for the pilot client.

## Results
| Metric | Value | Notes |
| --- | --- | --- |
| P50 latency | 182 ms | Within budget. |
| P95 latency | 327 ms | Below the 400 ms target. |
| Max latency | 389 ms | No retries required. |
| Error rate | 0% | All responses 200/JSON. |
| Telemetry check | `discovery.search.completed` events reported `degraded=false` throughout. |

## Observations & Follow‑ups
- GIN index `discovery_items_search_vector_idx` kept full-text search CPU under 55%; monitor for growth once ingestion surpasses 10k items.
- High-result scenarios (total > 1,000) trigger `degradeReason="results"`; the SPA should switch to virtualization-only mode when this flag appears.
- If latency crosses 400 ms P95 in staging or production, disable `discovery.filters.v1` for the affected client and rerun the benchmark after index vacuum/analyse.

## Script Usage
```
node scripts/discovery-search-benchmark.mjs \
  --client <clientId> \
  --items 1200 \
  --rps 50 \
  --duration 30
```
- `--seed` populates synthetic items (safe for local/staging).
- Provide `--url` to point at non-local environments.
- Results print percentile summary plus telemetry samples; copy the summary table above when updating this document.

## Rollback / Disable Checklist
1. Toggle `discovery.filters.v1` off for the affected client (`pnpm run flags -- toggle --feature discovery.filters.v1 --disable`).
2. Confirm telemetry shows `discovery.search.completed` with `degraded=false` after the toggle.
3. If degradation persists, revert to manual pagination in the SPA (Story 5.1 fallback) and open a hotfix ticket referencing this report.
