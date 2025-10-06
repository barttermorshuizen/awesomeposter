# Discovery Scoring Agent Implementation Notes

This guide supplements architecture docs with actionable steps for engineers implementing Story 4.1. It covers schema rollout, configuration hooks, and API/SSE contracts introduced by the scoring agent.

## 1. Schema & Migration Sequencing
1. Generate a Drizzle migration that creates `discovery_scores` (table + indexes) without touching other discovery tables.
2. Follow with a dedicated data migration that backfills existing `discovery_items`:
   - Select items lacking a `discovery_scores` row.
   - Reset their status to `pending_scoring` and enqueue them for the scoring agent, or insert default score rows if queuing is unavailable.
   - Make the migration idempotent so re-runs are safe.
3. Record both migrations in `packages/db/migrations` and update `packages/db/dist` via `pnpm run build` after validation.
4. Smoke test locally: `pnpm run db:migrate --filter discovery` followed by the backfill script/job.

## 2. Configuration Helpers & Fallbacks
- Extend `server/utils/client-config/feature-flags.ts` and `packages/agents-server/src/utils/feature-flags.ts` with helper methods that expose scoring weights/thresholds.
- Add Vitest coverage to exercise cache hit/miss, Redis pub/sub invalidation, and fallback defaults.
- Latch the last known weights in Redis (or in-memory) and define baseline defaults from the PRD so scoring can continue when the configuration service is unavailable. Use exponential backoff (1s, 2s, 4s, capped at 30s) before treating a fetch as failed.
- Gate scoring with a dedicated flag (e.g., `DISCOVERY_SCORING_ENABLED`). All scoring entry points must respect this flag so operators can disable the pipeline instantly.

## 3. Repository & Agent Changes
- Update `packages/agents-server/src/services/discovery-repository.ts` with upsert helpers that:
  - Write to `discovery_scores` alongside `discovery_items` status transitions (`pending_scoring` → `scored`/`suppressed`).
  - Emit queue cleanup for suppressed items so reviewer lists never reference them.
- Implement `DiscoveryScoringAgent` to:
  - Fetch weights via the updated configuration helpers.
  - Calculate keyword/recency/source-weight components and persist the breakdown JSON.
  - Respect suppression rollback rules (reset statuses on failure, publish `discovery.queue.updated`).

## 4. SSE & API Contracts
- Extend the `discovery.score.complete` SSE payload with:
  - `itemId`, `clientId`, `score`, and per-component contributions (`keyword`, `recency`, `sourceWeight`).
  - `statusOutcome` (`scored` or `suppressed`).
  - `threshold` and `weightsVersion` metadata so consumers can trace configuration history.
- Document the contract in `packages/shared/src/events/discovery.ts` and update any frontend/telemetry consumers accordingly.
- Add regression tests in `packages/agents-server/__tests__/discovery` to assert payload shape and suppression event ordering.

## 5. Deployment & Rollback Checklist
1. Apply schema migration in staging (`pnpm run db:migrate --filter discovery`).
2. Run the backfill job/script and confirm legacy items populate `discovery_scores`.
3. Deploy configuration helper updates and repository changes with `DISCOVERY_ENABLE=false` and `DISCOVERY_SCORING_ENABLED=false`.
4. Deploy the scoring agent and smoke-test locally + in staging (pipeline run, SSE event validation, reviewer queue sanity checks).
5. Enable scoring for a single pilot client via configuration helpers; monitor SSE telemetry and reviewer dashboards for one hour.
6. Expand rollout when error/precision metrics stay within PRD bounds.
7. Rollback triggers include precision <95%, queue anomalies, or sustained configuration fetch failures. On rollback:
   - Disable `DISCOVERY_SCORING_ENABLED` (halts new scoring runs).
   - Run the rollback SQL snippet to reset affected statuses.
   - If schema issues arise, execute `pnpm run db:rollback --filter discovery` and rerun the backfill once resolved.

Keep this document updated as the scoring feature evolves; link new helpers or payload changes here to maintain a single source for engineering hand-offs.

