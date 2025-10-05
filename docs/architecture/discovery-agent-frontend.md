# Discovery Agent Frontend Architecture

## Template & Framework Selection
AwesomePoster already ships a Vue 3 + Vite + Vuetify SPA. The discovery agent UI extends that single-page app, so no new starter template is introduced. All discovery surfaces (source configuration, dashboard, telemetry) live inside the existing workspace and follow current composition-API + Pinia conventions. This keeps bundle, tooling, eslint, and testing flows untouched.

### Change Log
| Date | Version | Description | Author |
| --- | --- | --- | --- |
| 2025-10-07 | v0.2 | Documented configurable web list UI, telemetry, and config suggestion flows. | Winston (Architect) |
| 2025-03-30 | v0.1 | Initial discovery agent frontend architecture aligned with existing stack. | Winston (Architect) |

## Frontend Tech Stack
The discovery UI reuses the approved stack. Versions stay in lockstep with `package.json` to avoid dependency drift.

| Category | Technology | Version | Purpose | Rationale |
| --- | --- | --- | --- | --- |
| Framework | Vue 3 (Composition API) | ^3.5.18 | SPA runtime | Already powers the app; discovery screens composed with `<script setup>` for parity. |
| UI Library | Vuetify 3 | ^3.9.6 | Component system, layout primitives | Existing design system; gives consistent visuals and accessibility helpers. |
| State Management | Pinia 3 | ^3.0.3 | Domain stores for briefs, sources, telemetry | Matches current stores (`hitl`, `ui`); no learning curve. |
| Routing | vue-router 4 | ^4.5.1 | Route-level screen management | Same history + lazy-load pattern as rest of app. |
| Build Tool | Vite 7 | ^7.0.6 | Dev server & bundler | Already configured; new modules auto-picked up. |
| Styling | Vuetify theme + Sass | ^1.91.0 | Tokens, overrides, scoped styles | Maintains central theming; only scoped Sass when Vuetify slots fall short. |
| Testing | Vitest + Vue Test Utils | ^3.2.4 / ^2.4.6 | Unit + component testing | Existing testing toolchain; no extra libs. |
| Component Library | Vuetify 3 | ^3.9.6 | Cards, data tables, dialogs | Reuse data table, filter chips, virtual scroll. |
| Form Handling | Native Vuetify inputs + composables | – | Source/keyword forms | Avoid extra form libs; validation handled via composables + Zod schemas shared from Nitro. |
| Animation | Vuetify transitions | – | List/detail transitions | Use built-in transitions (e.g., `expand-transition`) to limit dependencies. |
| Dev Tools | Vite Dev Server, Vue DevTools | – | DX | Current dev workflow continues to apply. |

## Project Structure
Discovery features follow the documented source tree. New directories sit under `src/` with domain-focused names so AI tooling can find the correct entry points.

```
src/
├─ views/
│  └─ discovery/
│     ├─ DiscoveryDashboardView.vue       # main list + detail workspace
│     ├─ DiscoverySourcesView.vue         # client source + keyword management
│     └─ DiscoveryTelemetryView.vue       # lightweight counts/exports
├─ components/
│  └─ discovery/
│     ├─ BriefList.vue
│     ├─ BriefFilters.vue
│     ├─ BriefDetailDrawer.vue
│     ├─ BulkActionBar.vue
│     ├─ SourceFormDrawer.vue
│     ├─ SourceListConfigForm.vue
│     ├─ ConfigSuggestionDialog.vue
│     ├─ SuggestionConfidenceBadge.vue
│     ├─ SourceHealthChip.vue
│     ├─ TelemetrySummaryCards.vue
│     └─ TelemetryEventFeed.vue
├─ stores/
│  ├─ discoveryBriefs.ts
│  ├─ discoverySources.ts
│  ├─ discoveryTelemetry.ts
│  └─ discoveryConfigSuggestions.ts
├─ lib/
│  ├─ agent-sse.ts                       # existing orchestrator SSE helper (unchanged)
│  └─ discovery-sse.ts                   # thin EventSource wrapper for telemetry stream
├─ composables/
│  └─ discovery/
│     ├─ useListConfig.ts                # form helpers + defaults for webList blocks
│     └─ useConfigSuggestions.ts         # orchestrates dialog + store wiring
└─ services/
   └─ discovery/
      ├─ briefs.ts
      ├─ sources.ts
      ├─ telemetry.ts
      └─ configSuggestions.ts
```

- `packages/shared/` gains typed models (`DiscoveryBrief`, `DiscoverySource`, `DiscoveryTelemetryEvent`, `DiscoveryListConfig`, `DiscoveryConfigSuggestion`) so SPA, Nitro API, and agents server share contracts.
- `server/api/discovery/*` handlers expose the CRUD + SSE endpoints consumed below.
- Feature flag plumbing (`packages/shared/src/config.ts`) centralises client enablement so SPA can hide routes when disabled.

## Component Architecture
The discovery workspace is split into focused, testable pieces.

```
+---------------------------------------------------------------+
| DiscoveryDashboardView                                        |
|  +--------------------+  +----------------------------------+ |
|  | BriefFilters       |  | BriefList (virtual scroll)       | |
|  | - chips/toggles    |  | - paged results w/ bulk select   | |
|  | - saved segments   |  | - optimistic status updates      | |
|  +--------------------+  +----------------------------------+ |
|                               |                                |
|                               v                                |
|                      BriefDetailDrawer                         |
|                      - metadata, scoring rationale             |
|                      - duplicate cluster cards                 |
|                      - note capture + promote dialog           |
+---------------------------------------------------------------+
```

- `BriefList` streams updates from the store (Pinia) and triggers bulk actions.
- `BriefDetailDrawer` reuses Vuetify `v-navigation-drawer` on the right, mirroring AgentResults popup styling for continuity.
- `BulkActionBar` appears when `selectedBriefIds` is non-empty; actions call store methods that wrap Nitro API endpoints.
- `SourceFormDrawer` is shared between add/edit flows and includes inline validation messages wired to shared Zod schemas.
- `TelemetrySummaryCards` renders aggregate counts; `TelemetryEventFeed` subscribes to SSE for near-real-time updates.

### Sources Management Flow
- `DiscoverySourcesView` pivots between the source grid and a right-hand configuration drawer. The drawer now nests `SourceListConfigForm` so operators can edit the optional `webList` block alongside existing credentials and scheduling fields (Story 3.4).
- `SourceListConfigForm` exposes selectors (`list_container_selector`, `item_selector`, `fields.*`, `pagination.next_page`). Defaults come from shared helpers in `useListConfig`, ensuring parity with backend heuristics and allowing per-field inline validation lifted from shared Zod schemas.

#### ConfigSuggestionsRequest
- `ConfigSuggestionDialog` launches from the form and calls the new `POST /api/discovery/config-suggestions` endpoint. Suggestions arrive as ready-to-paste JSON plus warnings; the dialog lets operators preview, accept into the form, or discard. Confidence chips render via `SuggestionConfidenceBadge` with consistent color thresholds (Story 3.6).

- Source save flows persist the merged `webList` configuration transparently; the store diffs nested selectors to avoid noisy updates, and optimistic UI messaging highlights when list extraction is active for a source (Story 3.5 alignment).

### Telemetry Enhancements
- `TelemetrySummaryCards` adds list-focused KPIs (`listItemCount`, `listSourcesConfigured`, `paginationDepth`) sourced from SSE aggregates so story 3.5 metrics surface without extra navigation.
- `TelemetryEventFeed` tags ingestion events when `webList` rules are applied, enabling operators to spot misconfigurations quickly. Pagination warnings from the backend appear as emphasized events with copy that links back to the relevant source.

## State Management
Each store follows the `defineStore` composition pattern already in use (`hitl`). Stores expose derived state, loading flags, optimistic queues, and SSE application hooks. Example:

```ts
// src/stores/discoveryBriefs.ts
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type {
  DiscoveryBrief,
  DiscoveryBriefFilters,
  DiscoverySseEvent,
  DiscoveryBulkAction,
} from '@awesomeposter/shared'
import { fetchBriefs, promoteBriefs, archiveBriefs } from '@/services/discovery/briefs'

export const useDiscoveryBriefsStore = defineStore('discoveryBriefs', () => {
  const filters = ref<DiscoveryBriefFilters>({
    status: ['spotted'],
    sourceIds: [],
    topics: [],
    query: '',
    sort: { field: 'score', direction: 'desc' },
    page: 1,
    pageSize: 25,
  })
  const briefs = ref<DiscoveryBrief[]>([])
  const total = ref(0)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const selectedIds = ref<Set<string>>(new Set())

  const hasSelection = computed(() => selectedIds.value.size > 0)

  async function load(force = false) {
    if (loading.value && !force) return
    loading.value = true
    error.value = null
    try {
      const response = await fetchBriefs(filters.value)
      briefs.value = response.items
      total.value = response.total
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Unable to load briefs.'
    } finally {
      loading.value = false
    }
  }

  function applySse(event: DiscoverySseEvent) {
    switch (event.type) {
      case 'brief-updated':
        upsertBrief(event.payload)
        break
      case 'brief-removed':
        briefs.value = briefs.value.filter(b => b.id !== event.payload.id)
        selectedIds.value.delete(event.payload.id)
        break
      case 'note-appended':
        updateNotes(event.payload)
        break
    }
  }

  async function runBulk(action: DiscoveryBulkAction) {
    const ids = Array.from(selectedIds.value)
    if (ids.length === 0) return
    try {
      if (action.kind === 'promote') {
        await promoteBriefs(ids, action.note)
      } else if (action.kind === 'archive') {
        await archiveBriefs(ids, action.reason)
      }
      selectedIds.value.clear()
    } finally {
      await load(true)
    }
  }

  return { filters, briefs, total, loading, error, selectedIds, hasSelection, load, applySse, runBulk }
})
```

- `discoverySources` mirrors the pattern with optimistic updates, nested `webList` state management, and background refresh for source health plus list extraction flags.
- `discoveryTelemetry` keeps rolling windows of aggregates and raw events for charting/export, now including list ingestion counters and pagination depth metrics emitted by server jobs.
- `discoveryConfigSuggestions` caches the most recent suggestions per URL, tracks request status, and normalizes confidence scores so the dialog/composable can present deterministic UI while avoiding duplicate API calls.
- Stores accept SSE frames so reconnect logic lives in one place rather than per component.

## API Integration
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
- `configSuggestions.request(url, options)` wraps `POST /api/discovery/config-suggestions`, returning `{ suggestion, alternatives, warnings }`. The helper normalizes selector casing, stamps timestamps for caching, and bubbles low-confidence flags so the dialog can prompt for manual review (Story 3.6).

## Realtime Telemetry (SSE)
Telemetry events stream from Nitro at `/api/discovery/events.stream`. We reuse the `EventSource` primitive instead of the POST-based helper used by orchestrator runs.

```ts
// src/lib/discovery-sse.ts
export function subscribeDiscoveryEvents(
  clientId: string,
  handlers: { onEvent: (event: DiscoverySseEvent) => void; onError?: (err: Event) => void },
): () => void {
  const url = new URL('/api/discovery/events.stream', window.location.origin)
  url.searchParams.set('clientId', clientId)
  const source = new EventSource(url.toString(), { withCredentials: true })

  source.onmessage = (evt) => {
    try {
      const payload = JSON.parse(evt.data)
      handlers.onEvent(payload)
    } catch (err) {
      console.error('Failed to parse discovery SSE event', err)
    }
  }

  source.onerror = (evt) => {
    if (handlers.onError) handlers.onError(evt)
    // browser auto-reconnect; optionally add backoff UI via store signal
  }

  return () => source.close()
}
```

- Store wires `subscribeDiscoveryEvents` within `onMounted`/`onUnmounted` composition helpers.
- `DiscoverySseEvent` covers `brief-updated`, `status-changed`, `source-health`, `telemetry-counts`, plus new `list-ingestion-metrics` and `pagination-warning` frames so stores can update list KPIs and surface alerts inline. Schema versioning stays in place so the UI can branch safely.
- SSE reconnect UI reuses the HITL reconnection pattern (toast + inline banner) for consistency.

## Routing & Navigation
Routes stay lazy-loaded and grouped under `/discovery`. Navigation entries only appear when the discovery feature flag is true for the authenticated client.

```ts
// src/router/index.ts (excerpt)
{
  path: '/discovery',
  component: () => import('@/views/discovery/DiscoveryShellView.vue'),
  meta: { requiresDiscovery: true },
  children: [
    { path: '', name: 'discovery-dashboard', component: () => import('@/views/discovery/DiscoveryDashboardView.vue') },
    { path: 'sources', name: 'discovery-sources', component: () => import('@/views/discovery/DiscoverySourcesView.vue') },
    { path: 'telemetry', name: 'discovery-telemetry', component: () => import('@/views/discovery/DiscoveryTelemetryView.vue') },
  ],
}
```

- `DiscoveryShellView` supplies the shared tabs + context switcher.
- `MainLayout.navItems` gains a single “Discovery” entry pointing to `discovery-dashboard`; guard logic hides it when `useDiscoveryFeature().enabled === false`.
- Route guard reads client context from shared config (`packages/shared/src/config.ts`) fetched during app bootstrap.

## Styling Guidelines
- Keep to Vuetify layout primitives (`v-container`, `v-row`) to align with other screens.
- Filters use `v-chip-group` + `v-select` so keyboard navigation remains intact.
- Detail drawer mirrors the HitL panel spacing scale (`pa-4`, `gap-4`).
- Status pills rely on the existing color tokens (e.g., `success`, `warning`); avoid bespoke hex values.
- Long tables use `v-data-table-server` with `fixed-header` and `height="calc(100vh - ???)"` to maintain scroll performance without new libs.
- For bulk action confirmation, reuse `v-dialog` + `v-toolbar` top rows to stay consistent with other modals.

### Theme Tokens
No new global CSS variables are required. If telemetry charts need accent colors, use Vuetify theme variants (`surface-variant`, `primary-lighten1`) rather than introducing custom palette entries.

## Testing Requirements
- **Stores**: Unit-test filter merging, SSE application, optimistic updates, nested `webList` state, and suggestion caching via Vitest.
- **Components**: Use Vue Test Utils to verify list rendering, empty states, form validation (including selector defaults), suggestion acceptance/decline flows, and bulk action behaviour.
- **Services**: Mock `fetch` to cover success, low-confidence, and error cases for `configSuggestions.request`, ensuring warnings propagate correctly.
- **Routing**: Add a guard test ensuring discovery routes redirect when the feature flag is disabled.
- **Accessibility**: Deferred until post-validation stage; no automated checks required for MVP.

```ts
// tests/discovery/DiscoveryDashboardView.spec.ts
import { render, screen, fireEvent } from '@testing-library/vue'
import DiscoveryDashboardView from '@/views/discovery/DiscoveryDashboardView.vue'
import { createTestingPinia } from '@pinia/testing'

it('renders brief list and triggers bulk promote', async () => {
  const pinia = createTestingPinia({ stubActions: false })
  const { getByRole, emitted } = render(DiscoveryDashboardView, { global: { plugins: [pinia] } })

  await screen.findByText('Spotted briefs')
  await fireEvent.click(getByRole('checkbox', { name: /select row/i }))
  await fireEvent.click(getByRole('button', { name: /promote/i }))

  const store = useDiscoveryBriefsStore()
  expect(store.runBulk).toHaveBeenCalledWith({ kind: 'promote', note: expect.any(String) })
  expect(emitted()).toMatchSnapshot()
})
```

- Extend Cypress/Playwright smoke scripts later if end-to-end coverage becomes necessary; not required for MVP.

## Environment & Feature Flags
- Discovery UI respects a shared config endpoint (e.g., `/api/config/me`) that already feeds client metadata. Extend it to include `discoveryEnabled`, `discoveryClientId`, `discoverySuggestionsEnabled`, and SSE token if required.
- No new public env vars are introduced. When server-side bearer auth is enforced (similar to HITL), reuse `VITE_AGENTS_AUTH_BEARER` by scoping Nitro middleware to accept the same header.
- If future pilots require a dedicated SSE host, we can add `VITE_DISCOVERY_SSE_BASE_URL` but leave it unset by default to avoid premature config churn. Suggestion caching TTL stays client-side; expose `VITE_DISCOVERY_SUGGESTION_CACHE_MINUTES` only if operator feedback demands tuning.

## Developer Standards
- Keep stores lean and serialisable; avoid embedding DOM state (e.g., `HTMLElement`) inside Pinia.
- Co-locate mock JSON fixtures under `tests/discovery/fixtures/` to encourage deterministic tests.
- Gate all network calls behind services; components should never `fetch` directly.
- Drive `webList` form validation from shared schemas (`useListConfig`) so selector requirements stay consistent with Nitro; never hardcode regex logic in components.
- When applying config suggestions, always merge through the composable helpers so warnings/confidence metadata persist in the store and can be surfaced in the UI afterwards.
- Every mutation endpoint must include the acting user + note, matching PRD requirements; surface validation feedback inline.
- Respect optimistic UI patterns but always reconcile with server truth on response (similar to HITL remove/resume flows).
- Document new SSE event types in `packages/shared/src/discovery-events.ts` with comments so backend/agents teams stay aligned.

## Decisions & Follow-ups
1. Telemetry widgets will ship with numeric counts only for MVP (no charts needed).
2. Server and client will use `page` + `pageSize` pagination; no cursor support required for MVP.
3. Track a story to specify the audit logging contract for bulk actions (fields, retention, UI surfacing) so API + UI can implement consistently.
4. Review operator feedback on config suggestion accuracy before enabling default auto-fill; keep manual confirmation mandatory until metrics justify change.
5. Coordinate with documentation/UX to publish selector authoring guidance linked directly from the `SourceListConfigForm` help icon.
