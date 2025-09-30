# Risk Mitigation
- **Primary Risk:** Orchestrator persistence and HITL records fall out of sync, causing stuck or duplicate runs.
- **Mitigation:** Use transactional persistence, integration tests, and monitoring around resume/remove flows.
- **Operational Triggers:** Track `hitl_pending_total` and `/api/hitl/*` error rate; if any pending request exceeds 10 minutes (time-to-answer breach, aligned with the `HITL_MAX_REQUESTS` cap of 3 per run) or error rate tops 5% over a rolling 5-minute window, flip `ENABLE_HITL=false` and investigate using the runbook.
- **Rollback Plan:** Gate HITL behind feature flag; disable HITL endpoints and UI to revert to current automated behavior while leaving additive schema intact.
