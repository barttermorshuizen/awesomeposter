# 5. Key Data Flows
## 5.1 Specialist raises HITL request
1. Specialist agent inspects context, decides to ask operator.
2. Within `withHitlContext`, agent calls `HitlService.raiseRequest` with payload (question/options/urgency).
3. Service enforces per-run limit, persists request via `DatabaseHitlRepository.create`, updates `hitl_state_json`, sets run status `awaiting_hitl`.
4. Orchestrator emits SSE frame `{ type: 'hitl_request', data: { request, runId } }` and marks loop idle.
5. UI receives event → store updates panel; Nitro `/api/hitl/pending` shows same run.

## 5.2 Operator responds (resume)
1. Operator enters answer in HITL panel.
2. UI POSTs `/api/hitl/resume` with `runId`, `requestId`, `responses[]`, `operator` metadata, optional note.
3. Handler validates payload, loads snapshot from `OrchestratorPersistence`, invokes `HitlService.applyResponses` to append to `hitl_responses`.
4. Persistence refresh writes `pending_request_id=null`, status `running`, extends `runnerMetadata.auditLog`.
5. Orchestrator’s watchdog detects cleared pending request on next tick (or via resume webhook) and restarts step loop injecting fresh responses into LLM prompts.
6. UI receives SSE `hitl_resolved` + subsequent plan updates.

## 5.3 Operator cancels (remove)
1. Operator chooses “Cancel request” (e.g., duplicate or invalid).
2. UI POSTs `/api/hitl/remove` with `runId`, optional `requestId`, reason, operator metadata.
3. Handler marks request denied, clears `pending_request_id`, sets run status `cancelled`, appends audit log.
4. Orchestrator stops loop; UI surfaces cancellation state; analytics receives `hitl_cancel_api` event.

## 5.4 Restart recovery
1. On orchestrator boot, `OrchestratorPersistence` loads all runs with `status=awaiting_hitl`.
2. Pending requests are replayed into in-memory cache; `listAwaitingHitl` still surfaces them.
3. When Nitro/UI resumes a run, same flow as 5.2 ensures continuity without duplicate requests.
