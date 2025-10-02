# Project Structure
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
│     ├─ SourceHealthChip.vue
│     ├─ TelemetrySummaryCards.vue
│     └─ TelemetryEventFeed.vue
├─ stores/
│  ├─ discoveryBriefs.ts
│  ├─ discoverySources.ts
│  └─ discoveryTelemetry.ts
├─ lib/
│  ├─ agent-sse.ts                       # existing orchestrator SSE helper (unchanged)
│  └─ discovery-sse.ts                   # thin EventSource wrapper for telemetry stream
└─ services/
   └─ discovery/
      ├─ briefs.ts
      ├─ sources.ts
      └─ telemetry.ts
```

- `packages/shared/` gains typed models (`DiscoveryBrief`, `DiscoverySource`, `DiscoveryTelemetryEvent`) so SPA, Nitro API, and agents server share contracts.
- `server/api/discovery/*` handlers expose the CRUD + SSE endpoints consumed below.
- Feature flag plumbing (`packages/shared/src/config.ts`) centralises client enablement so SPA can hide routes when disabled.
