# AwesomePoster Brownfield Enhancement PRD

## Intro Project Analysis and Context

### Existing Project Overview

#### Analysis Source
IDE-based fresh analysis (README.md, package manifests, src/, server/, packages/agents-server/, docs/orchestrator_requirements.md). No prior document-project artifact located.

#### Current Project State
- Vue 3 + Vite SPA in `src/` providing operator dashboards and create-post workflow.
- Nitro API in `server/` exposing REST endpoints for briefs, tasks, publishing, and background jobs.
- Dedicated agents server under `packages/agents-server/` orchestrating specialist LLM agents with SSE streaming telemetry.
- Shared domain logic in `packages/shared/` and persistence via Drizzle ORM targeting Postgres in `packages/db/`.
- R2 object storage hosts assets (raw MIME, attachments) referenced by agents and publishing surfaces.

### Available Documentation Analysis
- Tech Stack Documentation [ ]
- Source Tree/Architecture [ ]
- Coding Standards [ ]
- API Documentation [ ]
- External API Documentation [ ]
- UX/UI Guidelines [ ]
- Technical Debt Documentation [ ]
- Other: orchestrator_requirements.md, agentic_ai_social_poster_technical_design.md, migration_notes.md

_No document-project output found; leveraging in-repo docs and code inspection. Recommend running document-project later for comprehensive coverage._

### Enhancement Scope Definition

#### Enhancement Type
- [x] New Feature Addition
- [x] Major Feature Modification
- [ ] Integration with New Systems
- [ ] Performance/Scalability Improvements
- [x] UI/UX Overhaul (lightweight embed)
- [ ] Technology Stack Upgrade
- [ ] Bug Fix and Stability Improvements
- Other: —

#### Enhancement Description
Introduce a Human-in-the-Loop (HITL) service that any specialist agent can invoke during orchestration to collect operator decisions (approve/reject, choose between alternatives, answer open-ended questions). The orchestrator captures responses, replans accordingly, and persists human feedback alongside automated context. The first release surfaces HITL prompts inside the existing “Create Post” popup for internal operators.

#### Impact Assessment
- [ ] Minimal Impact (isolated additions)
- [ ] Moderate Impact (some existing code changes)
- [x] Significant Impact (substantial existing code changes)
- [ ] Major Impact (architectural changes required)

### Goals and Background Context

#### Goals
- Deliver a reusable HITL orchestration primitive any agent can trigger mid-plan.
- Provide operators an in-app prompt flow to approve, reject, select options, or answer freeform questions.
- Persist human decisions so the orchestrator replans deterministically with complete context.
- Maintain automated throughput when no HITL is required.

#### Background Context
Current orchestration is fully automated. Agents occasionally encounter ambiguous creative or strategic choices (e.g., divergent hooks) but lack a structured human checkpoint, leading to lower confidence outputs. Introducing HITL integrates knowledgeable operators into critical decision points, captures their guidance, and adapts subsequent planning. Embedding the v1 flow in the create-post popup leverages an existing touchpoint before expanding to inbox or external notifications in later iterations.

### Change Log
| Change | Date | Version | Description | Author |
|--------|------|---------|-------------|--------|
| Initial draft | 2025-09-24 | 0.1 | Created brownfield PRD outline for HITL orchestration feature. | PM |

## Requirements

### Functional Requirements
1. FR1: The orchestrator must allow any registered agent (e.g., StrategyManager, ContentWriter, QA) to emit a HITL request with payload metadata (prompt type, question, options, urgency) during plan execution.
2. FR2: The orchestrator must persist each HITL request in a shared store accessible to the Nitro API and Vue app, including originating agent, context artifacts, and required response schema.
3. FR3: The Vue “Create Post” popup must display pending HITL requests in-context, collecting operator responses (approve/reject, option selection, free-form answer) and posting results back to the orchestrator service.
4. FR4: Upon receiving a human response, the orchestrator must rehydrate plan state, append the response to execution context, and replan the next step without losing prior artifacts.
5. FR5: The HITL subsystem must support multiple simultaneous outstanding requests and ensure each maps to the correct orchestration thread and plan turn.
6. FR6: Operator decisions must be stored with timestamps and actor identity for future audit expansion, even if v1 has no explicit SLA or reporting UI.
7. FR7: The UI must let operators resume or cancel an in-progress orchestration (e.g., “Resume creating post” and “Remove running create post”) when a suspended plan is detected for a given briefing (after restart or manual pause).
8. FR8: The orchestrator must enforce a configurable maximum number of HITL requests per run (default 3 when unspecified); excess requests are denied with reason “Too many HITL requests,” prompting replanning while the originating agent continues without resubmitting that HITL.

### Non-Functional Requirements
1. NFR1: HITL round-trip latency (request to operator acknowledgement) must remain observable and must not block unrelated orchestrator threads; background polling/notifications must respect existing API performance budgets.
2. NFR2: Implement HITL capabilities using the existing stack (Vue 3, Nitro, Agents Server, Drizzle/Postgres) without introducing new primary infrastructure.
3. NFR3: Persist plan and HITL artifacts so orchestrator restarts can be resumed or explicitly cancelled through the new UI controls without data loss.
4. NFR4: Protect HITL payloads and responses via existing auth/session models so only authenticated internal operators can view or respond.

### Compatibility Requirements
1. CR1: Maintain compatibility with existing orchestrator API contracts; automated runs without HITL continue to behave as before.
2. CR2: Extend the database schema using additive migrations that leave existing queries and services unaffected.
3. CR3: Ensure new UI elements follow current Vuetify design patterns and do not regress the create-post workflow.
4. CR4: Preserve integrations with R2 asset storage and SSE streaming; HITL responses must integrate without disrupting existing telemetry.

## User Interface Enhancement Goals

### Integration with Existing UI
Embed HITL prompts within the current create-post popup, using Vuetify dialog components and existing form styling. Introduce a dedicated panel listing outstanding HITL questions with clear primary actions.

### Modified/New Screens and Views
- Create Post popup (new HITL panel)
- (Future) Orchestration management dashboard placeholder for resume/cancel controls

### UI Consistency Requirements
Apply current typography, spacing, and button styles. Reuse existing status chips for HITL states (Pending, Responded, Denied) and ensure accessibility (keyboard navigation, form labels) matches established guidelines.

## Technical Constraints and Integration Requirements

### Existing Technology Stack
**Languages**: TypeScript, JavaScript, SQL
**Frameworks**: Vue 3 + Vite SPA, Nitro server, OpenAI Agents SDK
**Database**: Postgres (Drizzle ORM)
**Infrastructure**: Vercel for SPA/Nitro, Cloudflare R2 for asset storage, optional Vercel Cron/Jobs
**External Dependencies**: OpenAI Agents SDK, Mailgun inbound email, Google APIs (optional), AWS SDK for R2-compatible access

### Integration Approach
**Database Integration Strategy**: Add HITL tables via Drizzle migrations for requests/responses; link to existing brief/orchestration tables.
**API Integration Strategy**: Extend Nitro API with endpoints for listing/resolving HITL tasks; agents server communicates via shared repository or RPC interface.
**Frontend Integration Strategy**: Use Pinia stores or composables to fetch HITL tasks, integrate with existing create-post popup actions, and manage resume/cancel flows.
**Testing Integration Strategy**: Expand unit tests (Vitest) for HITL stores/components; add integration tests for agents server orchestrator logic to cover HITL acceptance/rejection and denial scenarios.

### Code Organization and Standards
**File Structure Approach**: Place HITL-specific orchestrator logic in `packages/agents-server/src/orchestrator/hitl/`, Nitro handlers under `server/api/hitl/`, and Vue components in `src/components/hitl/`.
**Naming Conventions**: Follow existing kebab-case route naming, PascalCase components, and camelCase service functions.
**Coding Standards**: Adhere to repo ESLint/Prettier rules; maintain TypeScript strictness.
**Documentation Standards**: Document new endpoints and orchestration flows in `docs/orchestrator_requirements.md` appendix and update README quickstart as needed. Capture an internal handoff note linking to `docs/orchestrator-hitl-runbook.md`, naming operational owners for orchestrator/Nitro/UI, and listing the local dev steps to validate resume/remove before enabling the flag.
**Handoff Note**: `docs/internal/hitl-handoff.md` records the owners, validation checklist, enable/disable procedure, and reporting expectations for dev HITL toggles.

### Deployment and Operations
**Build Process Integration**: Ensure new packages compile via existing `npm run build` pipeline; no additional build steps required.
**Deployment Strategy**: Deploy alongside current SPA/Nitro/agents server services; schema migrations run before orchestrator release.
**Monitoring and Logging**: Extend existing Winston logging in agents server to include HITL events; surface counts in observability dashboards.
**Configuration Management**: Add HITL configuration (maxRequests, timeout thresholds) to environment settings with sensible defaults and documentation.

### Risk Assessment and Mitigation
**Technical Risks**: Plan persistence may drift from HITL persistence; mitigate with transactional updates and integration tests.
**Integration Risks**: UI may fall out of sync if multiple operators interact; mitigate with real-time refresh hooks or optimistic locking.
**Deployment Risks**: Schema migration errors could block orchestrator startup; mitigate with staging rollout and migration rollback scripts.
**Mitigation Strategies**: Establish feature flag for HITL rollout, monitor usage metrics, and prepare hotfix path to disable HITL if instability appears.

## Epic and Story Structure

**Epic Structure Decision**: Single epic with sequential stories focused on orchestrator, persistence, and UI integration; keeps one coordinated workflow that can be released behind a feature flag.

### Epic 1: Human-in-the-Loop Orchestration Enablement

**Epic Goal**: Provide a reusable HITL capability that any specialist agent can invoke, while giving operators in-app controls to respond, resume, or cancel orchestration runs.

**Integration Requirements**: Coordinate changes across the agents server, Nitro API, shared data models, and Vue client without regressing existing automated runs.

#### Story 1.1 Orchestrator HITL Core
As a platform orchestrator,
I want to accept, validate, and manage HITL requests from specialist agents during plan execution,
so that human decisions can be injected into the plan without breaking automated flows.

##### Acceptance Criteria
1: Orchestrator exposes an internal API for agents to raise HITL requests with payload metadata (question, options, urgency, origin agent).
2: Orchestrator enforces configurable per-run HITL limits and denies excess requests with reason "Too many HITL requests" while continuing execution.
3: Orchestrator rehydrates plan state with approved human responses and replans accordingly, including context updates for subsequent steps.
4: Orchestrator records denial reasons so agents can proceed automatically without resubmitting.

##### Integration Verification
IV1: Existing automated runs without HITL requests continue to pass regression tests.
IV2: SSE telemetry frames remain valid when HITL requests are raised, denied, or resolved.
IV3: Execution depth and quality thresholds continue to operate with HITL-enabled runs without significant performance degradation.

#### Story 1.2 Persistence and Resume Support
As a platform operator,
I want HITL requests and orchestration plans stored durably with resume/cancel hooks,
so that in-progress runs survive restarts and can be explicitly resumed or removed.

##### Acceptance Criteria
1: New Drizzle migrations add tables for HITL requests/responses and link them to briefs and orchestration threads.
2: Persisted plans and HITL records load correctly after orchestrator restart, exposing pending tasks via API.
3: API endpoints allow clients to resume an orchestration thread or mark it as removed/cancelled with audit metadata.
4: Automated smoke test confirms resume/cancel endpoints leave database in consistent state.

##### Integration Verification
IV1: Existing database queries continue to work with additive migrations applied.
IV2: Agents server restarts pick up pending HITL tasks without duplicating prior steps.
IV3: Removing a run clears pending HITL requests and releases any associated locks or timers.

#### Story 1.3 In-App HITL Prompt Experience
As an internal operator,
I want to review and answer HITL prompts within the create-post popup,
so that I can guide the orchestration without leaving my current workflow.

##### Acceptance Criteria
1: Create-post popup surfaces a HITL panel listing pending questions with metadata (origin agent, timestamp, type).
2: Operators can approve/reject, select from provided options, or submit free-form answers; validation enforces required fields per request type.
3: UI updates in near real time when new HITL prompts arrive or are resolved without needing a full page refresh.
4: Responses are submitted to the server and success/failure states are communicated to the operator.

##### Integration Verification
IV1: Vue components follow existing Vuetify styling and pass accessibility checks for keyboard focus and ARIA labelling.
IV2: Pinia store or composable managing HITL state interoperates with existing create-post data flow.
IV3: Submitting a response updates both the UI state and orchestrator context in a single optimistic workflow without desync.

#### Story 1.4 Restart Recovery Controls
As an internal operator,
I want reliable controls to resume or remove in-progress runs after service restarts,
so that stale orchestration states can be resolved without manual cleanup.

##### Acceptance Criteria
1: When a briefing has a suspended orchestration thread (e.g., after restart), the UI surfaces "Resume creating post" and "Remove running create post" actions with clear status messaging.
2: Resuming a run reloads the persisted plan and outstanding HITL context, then restarts the orchestrator from the last completed step without duplicating prior work.
3: Removing a run clears persisted plan/HITL records, unlocks the briefing for new runs, and records the operator and timestamp.
4: Operators receive confirmation indicators (toast or inline status) that the stale state has been successfully resumed or removed.

##### Integration Verification
IV1: Cancelling a run leaves no orphaned HITL records, locks, or timers in the database or orchestrator cache.
IV2: After an orchestrator restart, pending runs appear in the UI within the existing data refresh cadence without manual database intervention.
IV3: Resume/remove actions work under the HITL feature flag toggle, enabling safe rollback if the recovery flow encounters issues.
