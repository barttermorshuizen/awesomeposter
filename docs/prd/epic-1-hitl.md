# Epic HITL-1 — Human-in-the-Loop Orchestration Enablement - Brownfield Enhancement

## Epic Goal
Deliver a reusable human-in-the-loop (HITL) capability that any specialist agent can trigger, while providing internal operators in-app controls to respond, resume, or cancel orchestrations without regressing automated flows.

## Epic Description

**Existing System Context:**
- Current relevant functionality: Orchestrator-driven social content generation with automated strategy, drafting, and QA via OpenAI Agents SDK; Vue create-post popup for operator interaction.
- Technology stack: Vue 3 + Vite SPA, Nitro API server, Agents Server (OpenAI Agents SDK), Drizzle ORM with Postgres, Cloudflare R2 for assets.
- Integration points: Agents server orchestration loop, Nitro APIs for briefs/tasks, shared database models in `packages/db`, Vue create-post workflow and Pinia stores.

**Enhancement Details:**
- What's being added/changed: Introduce HITL request/response lifecycle, persistence, UI surfaces for operators, and restart recovery controls.
- How it integrates: Agents add HITL requests through orchestrator APIs; Nitro serves HITL endpoints; Vue popup embeds HITL panel; persisted state supports resume/cancel post-restart.
- Success criteria: Operators can answer agent questions mid-plan, orchestrator replans with responses, resume/cancel works after restarts, automated runs unaffected when HITL unused.

## Stories
1. **Story 1.1 Orchestrator HITL Core:** Implement agent-facing HITL request API, enforce configurable limits (default 3), handle approvals/denials, and rehydrate plan state with responses.
2. **Story 1.2 Persistence and Resume Support:** Add database persistence for HITL requests/responses and plans, plus APIs to resume or remove suspended runs safely.
3. **Story 1.3 In-App HITL Prompt Experience:** Enhance create-post popup with HITL panel to display pending prompts, collect operator responses, and stream updates.
4. **Story 1.4 Restart Recovery Controls:** Provide reliable resume/remove controls post-restart, ensuring stale runs are surfaced and cleared without manual cleanup.

## Compatibility Requirements
- [x] Existing APIs remain unchanged (HITL additions are additive and feature flagged).
- [x] Database schema changes are backward compatible (additive migrations only).
- [x] UI changes follow existing patterns (Vuetify dialog styling, status chips).
- [x] Performance impact is minimal (HITL processing avoids blocking other runs).

## Risk Mitigation
- **Primary Risk:** Orchestrator persistence and HITL records fall out of sync, causing stuck or duplicate runs.
- **Mitigation:** Use transactional persistence, integration tests, and monitoring around resume/remove flows.
- **Operational Triggers:** Track `hitl_pending_total` and `/api/hitl/*` error rate; if any pending request exceeds 10 minutes (time-to-answer breach, aligned with the `HITL_MAX_REQUESTS` cap of 3 per run) or error rate tops 5% over a rolling 5-minute window, flip `ENABLE_HITL=false` and investigate using the runbook.
- **Rollback Plan:** Gate HITL behind feature flag; disable HITL endpoints and UI to revert to current automated behavior while leaving additive schema intact.

## Definition of Done
- [ ] All stories completed with acceptance criteria met.
- [ ] Existing functionality verified through automated and manual regression tests.
- [ ] Integration points between agents server, Nitro API, and Vue UI validated end-to-end.
- [ ] Documentation updated (PRD, orchestrator requirements appendix, README quickstart).
- [ ] No regression observed in automated-only runs or SSE telemetry.

## Validation Checklist

**Scope Validation:**
- [x] Epic can be completed in 1-3 stories (plus one supporting control story) with bounded scope.
- [x] No architectural overhaul required; enhancement follows existing orchestrator patterns.
- [x] Integration complexity is manageable with additive changes.
- [x] Enhancement stays within brownfield constraints and existing stack.

**Risk Assessment:**
- [x] Risk to existing system kept low via feature flags and additive schemas.
- [x] Rollback plan is feasible (disable HITL feature, revert UI/flag).
- [x] Testing approach covers both HITL and automated regression scenarios.
- [x] Team owns orchestrator, Nitro, and Vue surfaces; integration points well understood.

**Completeness Check:**
- [x] Epic goal is clear and measurable (operators can intervene mid-plan reliably).
- [x] Stories are sequenced and scoped for incremental delivery.
- [x] Success criteria map directly to acceptance and integration checks.
- [x] Dependencies identified (agents server, Nitro API, Vue client, database migrations).

## Story Manager Handoff
"Please develop detailed user stories for Epic HITL-1 — Human-in-the-Loop Orchestration Enablement.

Key considerations:
- Enhancement touches Agents Server (OpenAI Agents SDK orchestrator), Nitro API, Vue SPA (Vuetify create-post popup), Drizzle/Postgres persistence, and Cloudflare R2 references.
- Integration points: orchestrator HITL request API, Nitro HITL endpoints, create-post popup data flows, resume/remove controls for suspended threads.
- Follow existing patterns in `packages/agents-server`, `server/api`, and `src/components`.
- Critical compatibility requirements: additive migrations only, automated runs unaffected when HITL disabled, UI adheres to current Vuetify conventions.
- Each story must ensure existing functionality (automated orchestration, SSE telemetry, create-post workflow) remains intact with explicit verification.

This epic should maintain system integrity while introducing reliable human decision checkpoints during post creation runs."
