# Stories
1. **Story 1.1 Orchestrator HITL Core:** Implement agent-facing HITL request API, enforce configurable limits (default 3), handle approvals/denials, and rehydrate plan state with responses.
2. **Story 1.2 Persistence and Resume Support:** Add database persistence for HITL requests/responses and plans, plus APIs to resume or remove suspended runs safely.
3. **Story 1.3 In-App HITL Prompt Experience:** Enhance create-post popup with HITL panel to display pending prompts, collect operator responses, and stream updates.
4. **Story 1.4 Restart Recovery Controls:** Provide reliable resume/remove controls post-restart, ensuring stale runs are surfaced and cleared without manual cleanup.
