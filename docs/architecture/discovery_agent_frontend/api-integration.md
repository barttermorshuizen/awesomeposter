# API Integration
All calls hit Nitro endpoints (`/api/discovery/...`) on the same origin, so the existing `fetch` usage pattern remains. We add named service modules under `src/services/discovery/` to keep components thin.

```ts
// src/services/discovery/briefs.ts
import type {
  DiscoveryBriefFilters,
  DiscoveryBriefListResponse,
  DiscoveryPromotePayload,
} from '@awesomeposter/shared'

const baseHeaders = { 'Content-Type': 'application/json', Accept: 'application/json' }

export async function fetchBriefs(filters: DiscoveryBriefFilters): Promise<DiscoveryBriefListResponse> {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value === undefined || value === null) return
    if (Array.isArray(value)) {
      value.forEach(v => params.append(key, String(v)))
    } else if (typeof value === 'object') {
      params.append(key, JSON.stringify(value))
    } else {
      params.append(key, String(value))
    }
  })
  const res = await fetch(`/api/discovery/briefs?${params.toString()}`, { headers: baseHeaders })
  if (!res.ok) throw new Error(`Failed to load briefs (${res.status})`)
  return res.json()
}

export async function promoteBriefs(ids: string[], note: string): Promise<void> {
  const payload: DiscoveryPromotePayload = { ids, note }
  const res = await fetch('/api/discovery/briefs/promote', {
    method: 'POST',
    headers: baseHeaders,
    body: JSON.stringify(payload),
  })
  if (!res.ok) throw new Error(`Promote failed (${res.status})`)
}
```

- Validation errors surface via JSON body; service helpers throw typed errors so components can show inline messaging.
- The same pattern is reused for sources (CRUD) and telemetry (fetch aggregates, request CSV export link).

## Config Suggestions Helper
`configSuggestions.request(url, options)` wraps `POST /api/discovery/config-suggestions`, returning `{ suggestion, alternatives, warnings }`. The helper normalizes selector casing, stamps timestamps for caching, and bubbles low-confidence flags so the dialog can prompt for manual review (Story 3.6).
