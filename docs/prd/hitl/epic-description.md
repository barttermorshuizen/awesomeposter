# Epic Description

**Existing System Context:**
- Current relevant functionality: Orchestrator-driven social content generation with automated strategy, drafting, and QA via OpenAI Agents SDK; Vue create-post popup for operator interaction.
- Technology stack: Vue 3 + Vite SPA, Nitro API server, Agents Server (OpenAI Agents SDK), Drizzle ORM with Postgres, Cloudflare R2 for assets.
- Integration points: Agents server orchestration loop, Nitro APIs for briefs/tasks, shared database models in `packages/db`, Vue create-post workflow and Pinia stores.

**Enhancement Details:**
- What's being added/changed: Introduce HITL request/response lifecycle, persistence, UI surfaces for operators, and restart recovery controls.
- How it integrates: Agents add HITL requests through orchestrator APIs; Nitro serves HITL endpoints; Vue popup embeds HITL panel; persisted state supports resume/cancel post-restart.
- Success criteria: Operators can answer agent questions mid-plan, orchestrator replans with responses, resume/cancel works after restarts, automated runs unaffected when HITL unused.
