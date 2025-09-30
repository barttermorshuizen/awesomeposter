# 8. Configuration & Feature Flagging
- Env vars in Nitro + agents server:
  - `ENABLE_HITL=true` to enable UI/API routes.
  - `HITL_MAX_REQUESTS` (default `3`) enforced inside `HitlService`.
  - `HITL_REQUEST_TTL` (optional future) to auto-expire stale prompts.
- UI hides HITL panel when flag disabled or no pending request present.
- Add shared config helper in `packages/shared/src/config.ts` consumed by Nitro + SPA via Vite env injection.
