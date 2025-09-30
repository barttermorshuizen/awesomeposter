# Story Manager Handoff
"Please develop detailed user stories for Epic HITL-1 — Human-in-the-Loop Orchestration Enablement.

Key considerations:
- Enhancement touches Agents Server (OpenAI Agents SDK orchestrator), Nitro API, Vue SPA (Vuetify create-post popup), Drizzle/Postgres persistence, and Cloudflare R2 references.
- Integration points: orchestrator HITL request API, Nitro HITL endpoints, create-post popup data flows, resume/remove controls for suspended threads.
- Follow existing patterns in `packages/agents-server`, `server/api`, and `src/components`.
- Critical compatibility requirements: additive migrations only, automated runs unaffected when HITL disabled, UI adheres to current Vuetify conventions.
- Each story must ensure existing functionality (automated orchestration, SSE telemetry, create-post workflow) remains intact with explicit verification.

This epic should maintain system integrity while introducing reliable human decision checkpoints during post creation runs."
