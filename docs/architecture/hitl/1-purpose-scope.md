# 1. Purpose & Scope
- Deliver a reusable human-in-the-loop (HITL) capability that any specialist agent can trigger during an orchestrated run.
- Keep existing automated orchestration flows working when HITL is not exercised (brownfield enhancement, additive only).
- Cover orchestration engine changes (`packages/agents-server`), Nitro API surfaces (`server/api/hitl`), Vue operator UI (`src/components/AgentResultsPopup.vue` + supporting stores), persistence (`packages/db`), and supporting telemetry.
- Outside scope: net-new specialist agents, major UX redesign of the create-post experience, or non-post workflows.
