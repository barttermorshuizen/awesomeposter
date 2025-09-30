# 6. API Surface
- `GET /api/hitl/pending`
  - Response: `{ ok: true, runs: [{ runId, threadId, briefId, pendingRequestId, status, updatedAt, executionContext, pendingRequest }] }`
- `POST /api/hitl/resume`
  - Body: `{ runId | threadId, requestId, responses: HitlResponseInput[], operator?, note? }`
  - Response: `{ ok: true, runId, status, pendingRequestId, requests, responses }`
- `POST /api/hitl/remove`
  - Body: `{ runId | threadId, requestId?, reason, operator?, note? }`
  - Response: `{ ok: true, runId, status: 'cancelled', requests, responses }`
- Ensure consistent error semantics: 401 (auth), 404 (run/request mismatch), 409 (stale state), 422 (validation).
