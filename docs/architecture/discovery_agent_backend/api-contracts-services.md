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

## Scoring Utility {#scoring-utility}
`server/utils/discovery/scoring.ts` provides read-only helpers that expose the shared relevance model to any Nitro workflow:

- `scoreDiscoveryItem(itemId: string)` – Returns `{ ok: true, result, config }` on success.
- `scoreDiscoveryItems(itemIds: string[])` – Batch variant that preserves the input order and short-circuits on invalid entries.

Each `result` contains the normalized score (`0–1`), applied threshold, status (`scored` or `suppressed`), and component breakdown `{ keyword, recency, source }`. Errors adopt the standard envelope:

```ts
const response = await scoreDiscoveryItems(['item-1', 'item-2'])
if (!response.ok) {
  console.error(response.error.code, response.error.details)
  return
}

for (const scored of response.results) {
  console.log(scored.itemId, scored.score, scored.components)
}
```

The helper enforces the `discovery-agent` feature flag before loading keywords or computing scores and never mutates state. Callers should persist the returned breakdown (and threshold) via their own repository layer if needed.
