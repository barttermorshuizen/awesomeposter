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
