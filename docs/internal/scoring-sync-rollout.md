# Discovery Scoring Sync Rollout Guide

This runbook covers the rollout of synchronous discovery scoring inside the ingestion job and the safeguards required to keep reviewer queues healthy.

## 1. Prerequisites
- Schema migrations `20250403_create_discovery_scores.sql` and `20250404_discovery_scores_constraints.sql` are deployed.
- Feature flags are wired for pilot clients in `client_features` (`discovery-agent`).
- Environment variables:
  - `DISCOVERY_SCORING_ENABLED` – master toggle for discovering scoring.
  - `DISCOVERY_SCORING_PENDING_THRESHOLD` – inline scoring backlog guard (defaults to `500`). Set to a lower value for cautious rollouts or `0` to force periodic-only scoring.

## 2. Rollout Sequence
1. **Enable ingestion sync scoring in staging**
   - Turn on `DISCOVERY_SCORING_ENABLED` for a single pilot client.
   - Confirm `server/jobs/discovery/ingest-sources.ts` writes score rows immediately after ingestion (check `discovery_scores`).
2. **Monitor telemetry**
   - `discovery.score.complete` and `discovery.queue.updated` events should flow for the pilot client.
   - `runMetrics.scoring` inside `discovery_ingest_runs.metrics_json` tracks `pendingBefore`, `pendingAfter`, attempt status, and any skip reason (`feature_disabled`, `backlog`, `error`).
   - The backlog guard emits `discovery.queue.updated` with `reason="backlog"` when `pending_scoring` exceeds the threshold.
3. **Expand to additional clients** once backlog stays below threshold and no `discovery.scoring.failed` events fire for 24 hours.
4. **Production rollout** mirrors staging: enable a single tenant, observe telemetry, then broaden.

## 3. Rollback Plan
- Disable `DISCOVERY_SCORING_ENABLED` for affected clients.
- Optionally set `DISCOVERY_SCORING_PENDING_THRESHOLD=0` to force periodic scoring while keeping the flag enabled for other tenants.
- Run `resetDiscoveryItemsToPending` (or the existing backfill script) if items were partially scored and need to return to the periodic queue.
- Monitor for cessation of `discovery.score.complete` events and ensure backlog drains via the periodic runner.

## 4. Monitoring & Alerts
- **Events**: subscribe to `discovery.score.complete`, `discovery.queue.updated`, and `discovery.scoring.failed` via the discovery SSE channel.
- **Logs**: look for `[discovery.ingest] inline scoring` log entries—`deferred due to backlog` indicates the threshold is being hit frequently.
- **Metrics**: dashboard `pending_scoring` counts and reviewer throughput. If the backlog climbs steadily, either increase the threshold or revert to periodic scoring.

## 5. Communication Checklist
- Notify the discovery PM/ops channel when enabling new clients.
- Provide a summary of scoring metrics (counts, suppression rate) after the first 24 hours of synchronous scoring.
- Document any threshold tweaks alongside incident notes for future tuning.

Keep this document updated as additional safeguards or automation land around synchronous scoring.
