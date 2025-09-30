# 7. Front-End State & UX Contract
- **Store**: `src/stores/hitl.ts` exposes state, actions, computed properties (`isAwaiting`, `activeRequest`, `isBusy`). Provides `connect(runId, correlationId)` to bind SSE stream, `submitResponse`, `cancelRequest`, `reloadPending`.
- **Components**:
  - `HitlPanel.vue`: lists requests, displays detail view with question, options (rendered as buttons). Shows agent origin icon + timestamp.
  - `HitlResponseForm.vue`: handles freeform text, approval toggles, option selection.
- **SSE Handling**: Extend `src/lib/agent-sse.ts` to route new event types to listeners. On websocket/SSE disconnect, fetch `/api/hitl/pending` to resync.
- **Accessibility**: Provide keyboard navigation and ARIA roles for panel; highlight urgent requests.
- **Error handling**: surface toast notifications via existing UI store when resume/remove fails.
