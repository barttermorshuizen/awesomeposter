# Configuration & Feature Flag Management

## Feature Flags
- **System-wide flags** live as environment variables that gate shared behaviour across all tenants. Current flags include `ENABLE_HITL` (gates HITL UI/API exposure), `HITL_MAX_REQUESTS`, and any additional tier-0 switches introduced in deployment manifests.
- **Client-specific flags** are persisted in the shared `client_features` table. Each record tracks `client_id`, `feature`, `enabled`, `created_at`, and `updated_at`, letting us scope functionality to individual customers without redeploying infrastructure.

## Client Feature Storage
Keep the client-level feature catalogue in the existing shared configuration database alongside other tenant settings. The `client_features` table schema is:

| Column | Type | Notes |
| --- | --- | --- |
| `client_id` | `uuid` (FK) | Identifies the tenant; must match the primary key used by scoring/ingestion services. |
| `feature` | `text` | Stable feature identifier (e.g., `hitl`, `scoring-pro`, `beta-dashboard`). |
| `enabled` | `boolean` | `true` when the feature is active for the client; defaults to `false`. |
| `created_at` | `timestamp` | Auto-managed insert timestamp. |
| `updated_at` | `timestamp` | Auto-managed modification timestamp. |

## Helper API & Service Contract
Use the shared helper `isFeatureEnabled(clientId: string, feature: string)` exposed via `server/utils/client-config/feature-flags.ts` (Nitro) and `packages/agents-server/src/utils/feature-flags.ts` (agents runtime). The helper should:
- Read from the cache-first layer (see below) and fall back to the database.
- Default to `false` for unknown clients/features to ensure fail-safe behaviour.
- Expose typed errors for lookup failures so callers can distinguish between “not found” and infrastructure issues.

All backend entry points that evaluate client-specific functionality must call this helper before processing:
- **Ingestion** (e.g., `server/api/ingestion/**` handlers and scheduled jobs) must confirm the flag before accepting or queuing work.
- **Scoring** services in `packages/agents-server` should gate relevance/pilot logic with the helper.
- **Dashboard** APIs under `server/api/dashboard/**` must verify access prior to responding so UI cannot bypass enforcement.

## Caching & Invalidation
`isFeatureEnabled` fronts a Redis-backed cache implemented in `server/utils/client-config/feature-flags.ts` (mirrored in `packages/agents-server/src/utils/feature-flags.ts`) using the `@upstash/redis` client already included in the workspace, with an in-process Map fallback for local/test runs. Behaviour requirements:
- Cache entries store `client_id` + `feature` booleans with a TTL ≤ 2 minutes.
- Whenever the admin UI toggles a flag, publish the `feature.flags.updated` message on the shared pub/sub bus (via the existing eventing helpers) containing `{ clientId, feature }`.
- Cache subscribers must invalidate matching keys immediately; the overall propagation time from toggle → backend consistency must not exceed 2 minutes.

## UI Coordination
Admin toggles (see Story 7.2) are the canonical control plane:
- The toggle workflow writes authoritative state to the `client_features` table and then publishes the `feature.flags.updated` event.
- UI messaging should mirror backend state transitions (loading, enabled, disabled) so operators get consistent feedback when propagation is pending.

## Telemetry & Fail-Safes
Telemetry emitters (both SPA and server-side) must call `isFeatureEnabled` before emitting client-specific events. If the helper returns `false` or throws a lookup error, skip emitting metrics for that feature—silent drop rather than partial payloads. Unknown or error conditions must default to disabled to prevent accidental rollout.

## Testing Expectations
- **Unit tests** for `isFeatureEnabled` covering enabled, disabled, cache hit/miss, and the default fail-safe path.
- **Integration test** that flips a flag via the pub/sub topic, asserting cache invalidation and updated helper responses.
- **End-to-end scenario**: toggle a client on through the admin UI, observe dashboard + ingestion/scoring responses respect the new state, then toggle off and reconfirm.
- **Negative path** that simulates lookup failures (e.g., DB offline) verifying the helper returns `false` and callers short-circuit processing.

## References
- `docs/architecture/config-management.md#feature-flags`
- `docs/stories/7.2.feature-flag-admin-toggle.md`
