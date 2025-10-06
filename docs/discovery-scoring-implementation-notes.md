# Discovery Scoring Agent Implementation Notes

This guide supplements architecture docs with actionable steps for engineers implementing Story 4.1. It covers schema rollout, configuration hooks, and API/SSE contracts introduced by the scoring agent.

## 1. Schema & Migration Sequencing
1. Generate a Drizzle migration that creates `discovery_scores` (table + indexes) without touching other discovery tables. (See `packages/db/migrations/20250403_create_discovery_scores.sql`).
2. Follow with a dedicated data migration that backfills existing `discovery_items`:
   - Select items lacking a `discovery_scores` row.
   - Reset their status to `pending_scoring` and enqueue them for the scoring agent, or insert default score rows if queuing is unavailable.
   - Make the migration idempotent so re-runs are safe.
3. Record both migrations in `packages/db/migrations` and update `packages/db/dist` via `pnpm run build` after validation (`20250404_discovery_scores_constraints.sql` adds range checks/indexes).
4. Smoke test locally: `pnpm run db:migrate --filter discovery` followed by the Node helper `node scripts/discovery-backfill-scores.mjs` (idempotent; accepts optional batch size).

## 2. Configuration Helpers & Fallbacks
- `packages/agents-server/src/utils/discovery-scoring-config.ts` owns environment parsing and normalization (keyword/recency/source weights, threshold, half-life). It falls back to documented defaults and logs invalid overrides via the shared logger.
- Sibling helpers (`server/utils/client-config/feature-flags.ts`, `packages/agents-server/src/utils/feature-flags.ts`) continue to surface high-level discovery toggles; scoring reads `DISCOVERY_SCORING_ENABLED` before touching the queue.
- Cache configuration results in-memory (already handled by the helper) and surface a `weightsVersion` integer so SSE consumers can correlate telemetry with rollout notes.

## 3. Repository & Agent Changes
- `packages/agents-server/src/services/discovery-repository.ts` wraps Drizzle helpers to upsert `discovery_scores`, transition `discovery_items.status`, and expose backfill utilities.
- `packages/agents-server/src/agents/discovery-scoring.ts` calculates keyword/recency/source components, persists the breakdown, and emits both `discovery.score.complete` and `discovery.queue.updated` agent events. Suppression calls `removeFromReviewerQueue` so dashboard queues never contain stale work.
- Keyword lookups live in `packages/agents-server/src/services/discovery-keywords.ts` (simple TTL cache); queue signalling resides in `packages/agents-server/src/services/discovery-queue.ts`.

## 4. SSE & API Contracts
- `packages/shared/src/discovery-events.ts` now defines `discovery.score.complete` and `discovery.queue.updated` envelopes plus telemetry shapes.
- `server/utils/discovery-telemetry.ts` converts both events into consumer-ready SSE frames/namespaced telemetry for dashboards.
- Vitest coverage (`packages/agents-server/__tests__/discovery/discovery-scoring.agent.spec.ts`) verifies persistence wiring, queue notifications, and emitted telemetry payloads.

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
