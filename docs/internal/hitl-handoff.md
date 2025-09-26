# HITL Dev Environment Handoff Note

## Purpose
This note captures the operational handshake for enabling the HITL feature flag inside the shared development environment. Follow these steps each time the flag is toggled on or the recovery APIs are changed.

## Owners
- **Orchestrator / Agents Server:** @bart (engineering lead)
- **Nitro API:** @bart (engineering lead)
- **Vue UI (Create Post Popup + HITL Panel):** @bart (engineering lead)
- **Operator Runbook Maintainer:** @bart (keeps `docs/orchestrator-hitl-runbook.md` current)

## Required References
- Runbook: `docs/orchestrator-hitl-runbook.md`
- Architecture context: `docs/architecture/epic-1-hitl-architecture.md`
- PRD: `docs/prd/epic-1-hitl.md`

## Pre-Flag Validation Steps
1. **Agents Server Check**
   - Ensure `HITL_MAX_REQUESTS` is set (defaults to `3`) and agents server boots without schema drift warnings.
   - Run `npm run dev:agents` and confirm `hitl_request_created` logs appear when a request is raised via test harness (see `packages/agents-server/__tests__/hitl-api.integration.spec.ts`).
2. **Nitro API Check**
   - Start Nitro with `npm run dev:api` and verify `/api/hitl/pending` returns empty list under bearer token auth.
   - Issue synthetic `POST /api/hitl/resume` and `POST /api/hitl/remove` using the runbook sample payloads; expect 404 for unknown runs.
3. **UI Check**
   - Launch the SPA (`npm run dev`) with `VITE_ENABLE_HITL=true`.
   - Confirm the HITL panel stays hidden until a pending request is present; when injected via test harness, verify panel renders and actions flow to Nitro.
4. **Telemetry Sanity**
   - Tail agents server logs to ensure `hitl_pending_total` metric updates (or placeholder log until StatsD wiring exists).
   - Validate that no pending request remains unresolved beyond 10 minutes during the test cycle.

## Enable / Disable Procedure
1. Toggle `ENABLE_HITL=true` in both Nitro and SPA environments.
2. Notify contributors in the dev channel that HITL is live; include links to the runbook and this handoff note.
3. Monitor logs for 30 minutes; if any pending request exceeds 10 minutes or `/api/hitl/*` error rate exceeds 5% of calls over five minutes, disable the flag and debug per runbook guidance.
4. To disable, revert `ENABLE_HITL=false` and rerun the pre-flag validation to ensure the system reverts cleanly.

## Reporting
- Record a bullet in `docs/orchestrator-hitl-runbook.md` under a new “Flag History” section (timestamp, action, notes) after each enable/disable event.
- Capture telemetry observations and outstanding follow-ups in the next weekly checkpoint per architecture doc guidance.

