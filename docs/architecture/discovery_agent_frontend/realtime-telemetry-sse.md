# Realtime Telemetry (SSE)
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
