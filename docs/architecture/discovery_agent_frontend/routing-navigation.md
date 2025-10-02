# Routing & Navigation
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
