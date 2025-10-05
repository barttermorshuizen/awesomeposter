# Component Architecture
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

## Sources Management Flow
- `DiscoverySourcesView` pivots between the source grid and a right-hand configuration drawer. The drawer now nests `SourceListConfigForm` so operators can edit the optional `webList` block alongside existing credentials and scheduling fields (Story 3.4).
- `SourceListConfigForm` exposes selectors (`list_container_selector`, `item_selector`, `fields.*`, `pagination.next_page`). Defaults come from shared helpers in `useListConfig`, ensuring parity with backend heuristics and allowing per-field inline validation lifted from shared Zod schemas.
- `ConfigSuggestionDialog` launches from the form and calls the new `POST /api/discovery/config-suggestions` endpoint. Suggestions arrive as ready-to-paste JSON plus warnings; the dialog lets operators preview, accept into the form, or discard. Confidence chips render via `SuggestionConfidenceBadge` with consistent color thresholds (Story 3.6).
- Source save flows persist the merged `webList` configuration transparently; the store diffs nested selectors to avoid noisy updates, and optimistic UI messaging highlights when list extraction is active for a source (Story 3.5 alignment).

## Telemetry Enhancements
- `TelemetrySummaryCards` adds list-focused KPIs (`listItemCount`, `listSourcesConfigured`, `paginationDepth`) sourced from SSE aggregates so story 3.5 metrics surface without extra navigation.
- `TelemetryEventFeed` tags ingestion events when `webList` rules are applied, enabling operators to spot misconfigurations quickly. Pagination warnings from the backend appear as emphasized events with copy that links back to the relevant source.
