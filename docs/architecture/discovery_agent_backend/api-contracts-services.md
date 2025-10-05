# API Contracts & Services

## Validation
Extend `packages/shared/src/schemas.ts` with `DiscoverySourceSchema`, `DiscoveryItemResponse`, etc. Nitro handlers import these Zod schemas for both validation and type inference, mirroring existing `/api/clients` patterns. The schema includes the optional `webList` block with selector requirements enforced when provided.

## Services
Add `server/utils/discovery-repository.ts` that exposes typed CRUD helpers using Drizzle. This keeps API files thin and matches the `hitlRepository` approach.

## Bulk Operations
Promotion/archival endpoints wrap a shared service that sets `discovery_items.status` and writes an audit entry to `discovery_metrics` for real-time updates.

## SSE Payload
`packages/shared/src/discovery-events.ts` defines the envelope `{ type: 'brief-updated' | 'source-health' | 'metrics', payload, version }`—Nitro simply rehydrates DB rows and publishes via `eventHandler`. The frontend converts them with the new `subscribeDiscoveryEvents` helper already described in the UI document.

## Configuration Discovery Service
`server/services/discovery-config-suggestions.ts` encapsulates DOM fetching, selector heuristics, confidence scoring, and schema validation before returning results to the new API endpoint. This isolates parsing complexity from the route handler and keeps it reusable for future UI tooling.
