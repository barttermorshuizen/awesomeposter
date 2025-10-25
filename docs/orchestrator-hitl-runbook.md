# Orchestrator HITL Resume/Remove Runbook

## Scope
Operational guidance for platform operators when resuming or cancelling Human-in-the-Loop (HITL) orchestrations that are paused awaiting input. Applies to the `/api/hitl/resume` and `/api/hitl/remove` endpoints shipped with Story 1.2.

## Prerequisites
- `DATABASE_URL` and `OPENAI_API_KEY` set in the server environment (see project `.env`).
- API clients must authenticate with the bearer token configured in `API_KEY`.
- Operators should have access to the pending HITL request ID (surfaced via UI or `/api/hitl/pending`).

## Inspect pending HITL runs
```http
GET /api/hitl/pending
Authorization: Bearer <API_KEY>
```
Response includes `runId`, `threadId`, `pendingRequestId`, and execution context. Use this to confirm the target run before taking action.
- Each pending request exposes `operatorPrompt`, `pendingNodeId`, and a serialized `contractSummary` (facets + capability contract). Surface these to operators so they can review the orchestrator-provided guidance and the exact node expectations before resuming or cancelling the run.

## Resume a paused run
```http
POST /api/hitl/resume
Authorization: Bearer <API_KEY>
Content-Type: application/json
{
  "runId": "run_xxx",            // or supply threadId instead
  "requestId": "hitl_req_xxx",
  "responses": [
    {
      "requestId": "hitl_req_xxx",
      "responseType": "approval", // approval | rejection | option | freeform
      "approved": true,
      "freeformText": "Operator answer",
      "responderId": "operator-123",
      "responderDisplayName": "Op Name"
    }
  ],
  "operator": {
    "id": "operator-123",
    "displayName": "Op Name",
    "email": "ops@example.com"
  },
  "note": "Approved after review"
}
```
- Either `runId` or `threadId` is required; `requestId` must match the current pending request.
- Multiple responses can be supplied in one call if needed.
- Successful responses return the updated run state and clear `pendingRequestId`.

## Cancel/remove a pending request
```http
POST /api/hitl/remove
Authorization: Bearer <API_KEY>
Content-Type: application/json
{
  "runId": "run_xxx",            // or threadId
  "requestId": "hitl_req_xxx",   // optional, defaults to current pending request
  "reason": "Operator cancelled", // stored as denial reason
  "operator": {
    "id": "operator-123",
    "displayName": "Op Name"
  },
  "note": "Duplicate request"
}
```
- Marks the request as denied and transitions the run to `cancelled`. The hitl state snapshot records the decision for audit.

## Audit trail & metrics
- Resume/remove calls append entries in the orchestrator run metadata (`auditLog`) with operator info, timestamp, and notes.
- Telemetry events `hitl_resume_api` and `hitl_cancel_api` are emitted via the shared logger for observability.

## Recovery & troubleshooting
- If `/api/hitl/resume` or `/api/hitl/remove` return 404, ensure you are using the correct `runId`/`requestId`. Use `/api/hitl/pending` to cross-check.
- A 409 response means the request is no longer pending (already resolved or a different request is active).
- When the agents server restarts, the orchestrator automatically rehydrates pending HITL runs from `orchestrator_runs`/`hitl_requests` tables; operators should re-issue resume/remove calls as needed.

Keep this runbook alongside the release notes for Story 1.2. Update when new operator actions are added.
