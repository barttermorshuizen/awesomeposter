# API Contracts & Services
- **Validation**: extend `packages/shared/src/schemas.ts` with `DiscoverySourceSchema`, `DiscoveryItemResponse`, etc. Nitro handlers import these Zod schemas for both validation and type inference, mirroring existing `/api/clients` patterns.
- **Services**: add `server/utils/discovery-repository.ts` that exposes typed CRUD helpers using Drizzle. This keeps API files thin and matches the `hitlRepository` approach.
- **Bulk operations**: promotion/archival endpoints wrap a shared service that sets `discovery_items.status` and writes an audit entry to `discovery_metrics` for real-time updates.
- **SSE payload**: `packages/shared/src/discovery-events.ts` defines the envelope `{ type: 'brief-updated' | 'source-health' | 'metrics', payload, version }`—Nitro simply rehydrates DB rows and publishes via `eventHandler`. The frontend converts them with the new `subscribeDiscoveryEvents` helper already described in the UI document.
