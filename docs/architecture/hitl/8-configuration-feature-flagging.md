# 8. Configuration & Feature Flagging
- Env vars in Nitro + agents server:
  - `ENABLE_HITL=true` to enable UI/API routes.
  - `HITL_MAX_REQUESTS` (default `3`) enforced inside `HitlService`.
  - `HITL_REQUEST_TTL` (optional future) to auto-expire stale prompts.
- UI hides HITL panel when flag disabled or no pending request present.
- Add shared config helper in `packages/shared/src/config.ts` consumed by Nitro + SPA via Vite env injection.

## 8.1 Flex Task Panel Configuration
- SPA loads facet-driven flex assignments when both `VITE_FLEX_AGENTS_BASE_URL` and the corresponding bearer (`VITE_FLEX_AGENTS_AUTH_BEARER` or fallback `VITE_AGENTS_AUTH_BEARER`) are configured. Missing credentials disable submissions and surfaces an error toast.
- `VITE_FLEX_REQUIRE_HITL=true` keeps long-running flex runs paused until operators submit via the new Flex Task Panel; when omitted the orchestrator behaves opportunistically and resumes once human payloads arrive.
- The Flex Task Panel rehydrates backlog state on load using `GET /api/v1/flex/tasks`, so operators who reconnect after downtime still see pending work. A manual refresh button is available for force-sync.
- Assignments flow exclusively through the flex endpoints (`/api/v1/flex/tasks/*`, `/api/v1/flex/run.resume`) and never touch legacy `/api/hitl/*` routes, keeping policy approvals isolated from human task execution.
