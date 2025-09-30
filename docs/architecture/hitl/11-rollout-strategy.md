# 11. Rollout Strategy
1. **Dry run in staging** with feature flag on; validate SSE, persistence, resume/remove flows using runbook.
2. **Shadow mode**: enable orchestrator HITL raising but keep UI hidden; verify pending runs via API + telemetry.
3. **Internal beta**: enable UI for a small operator group; monitor metrics.
4. **General availability**: expand flag, add monitoring alerts.
5. **Fallback**: disable `ENABLE_HITL` to revert UI/APIs while keeping additive schema intact.
