# AwesomePoster Agentic Architecture (Flex Edition)

## Introduction
- Purpose: capture the **current reality** of AwesomePoster’s agentic stack with emphasis on the latest flex server iteration for digital marketing content generation.
- Audience: product management and architectural stakeholders needing a trustworthy blueprint for feature planning, refactors, and platform risk assessment.
- Scope: Vue SPA, Nitro APIs, shared libraries, databases, the legacy agents server, and the new `@awesomeposter/flex-agents-server` runtime (planner, HITL, capability registry, and tools). Out of scope: aspirational redesigns or legacy discovery modules not exercised by flex.

## System Overview
- **Business domain**: digital marketing copilot that ingests briefs/assets, plans multi-agent workflows, and emits optimized LinkedIn-style posts with knob-controlled variants, QA, and human overrides.
- **Delivery surfaces**: a Vue 3 + Vuetify SPA (`src/`) and Nitro API (`server/`) deployed together; both interact with shared Drizzle/Postgres storage (`packages/db`) and Redis-backed feature flags.
- **Agent runtimes**: legacy orchestrator (`packages/agents-server`) still powers production flows; the flex server (`packages/flex-agents-server`) is a drop-in replacement offering runtime planning, dynamic policies, richer telemetry, and sandbox tooling.
- **Shared contracts**: the `@awesomeposter/shared` package exposes Zod schemas and enums under `packages/shared/src/flex/*` that every caller (UI, planners, execution engine, tests) must import to stay aligned.

## Frontend SPA (Vue + Vuetify)
- **Entry point**: `src/main.ts` bootstraps Vuetify, Pinia, and router routes for briefs, clients, settings, discovery, and the flex sandbox UI.
- **Flex UI**: `src/components/FlexCreatePostDialog.vue` streams `FlexEvent` frames via `postFlexEventStream` (`src/lib/flex-sse.ts`) against `POST /api/v1/flex/run.stream`. It orchestrates HITL resumes, renders plan graphs, and surfaces validation errors from flex. `src/components/FlexSandboxPlanInspector.vue` visualizes planner nodes/capabilities.
- **HITL surfaced**: `src/stores/hitl.ts` tracks pending requests so operators can resume paused runs from the popup. `HitlPromptPanel.vue` displays queued escalations matching server payloads.
- **Sandbox route**: `src/views/FlexSandboxView.vue` pulls metadata from `GET /api/v1/flex/sandbox/metadata` and loads draft TaskEnvelopes for experimentation, gated by feature flags/envs (see `VITE_USE_FLEX_DEV_SANDBOX` in components).

## API Layer (Nitro `server/`)
- **Responsibility**: CRUD for clients, briefs, tasks, discovery sources (`server/api/**`), plus upload helpers and auth middleware. These endpoints hydrate the SPA and populate DB tables consumed by agents.
- **Flex bridge**: the SPA never calls the legacy agents server directly; environment variables (`VITE_FLEX_AGENTS_BASE_URL`, `VITE_FLEX_AGENTS_AUTH_BEARER`) point the UI to whichever Nitro instance runs the flex server.
- **Security**: `server/middleware/auth.ts` enforces bearer-token auth when `API_KEY` is set; `packages/flex-agents-server/server/middleware/auth.ts` mirrors the pattern with `FLEX_API_KEY`.

## Data & Storage
- **Database**: Postgres 16 via Drizzle ORM (see `docker-compose.dev.yml`, `packages/db/src/schema.ts`). Key tables: `clients`, `client_profiles`, `briefs`, `assets`, `posts`, `post_metrics`, `knob_experiments`, and HITL state tables (`orchestratorRuns`, `flexRuns`, `flexPlanNodes`). Schemas model marketing briefs, 4-knob experimentation, and performance telemetry.
- **Migrations**: `packages/db/migrations/` with Drizzle config in `packages/db/drizzle.config.ts`. Scripts `npm --prefix packages/db run gen/push` keep schema synced.
- **Feature flags**: `packages/flex-agents-server/src/utils/feature-flags.ts` caches client-level features in Upstash Redis (`UPSTASH_REDIS_REST_URL/TOKEN`), defaulting to in-memory caches when unavailable. Critical check `requireDiscoveryFeatureEnabled` gates discovery-enriched briefs before agents touch them.
- **Secrets & env**: `.env` entries include model API keys (`FLEX_OPENAI_API_KEY`), concurrency tuning (`SSE_CONCURRENCY`, `SSE_MAX_PENDING`), and HITL quotas (`HITL_MAX_REQUESTS`). Nitro plugins (`server/plugins/require-env.ts`) warn when critical envs are missing.

## Agentic Stack – Current State

### Legacy Orchestrator (`packages/agents-server`)
- Keeps production-safe behavior, HITL integration, and Nitro deployment identical to pre-flex versions.
- Persistence and schema compatibility preserved under `@awesomeposter/db`. `packages/agents-server/src/services/orchestrator-persistence.ts` exports storage helpers reused by flex for backwards compatibility.
- Continues to serve non-flex endpoints while the new stack matures; dual-running supported via shared database and feature flags.

### Flex Agents Server (`packages/flex-agents-server`)
- **Runtime**: Nitro 2.12 deployed as standalone service. `routes/api/v1/flex/run.stream.post.ts` exposes the core SSE endpoint; concurrency is throttled by `src/utils/concurrency.ts` using an in-process semaphore and backlog counters.
- **Contracts**: All request/response payloads validated against Zod schemas from `@awesomeposter/shared/src/flex/types.ts` (TaskEnvelope, OutputContract, FlexEvent, HITL payloads).
- **Planner lifecycle**: `FlexRunCoordinator` orchestrates runs:
  1. Normalizes policies (`PolicyNormalizer`), resolves thread/resume metadata, and persists run snapshots via `FlexRunPersistence` (Drizzle-backed `flexRuns`, `flexPlanNodes` tables).
  2. Requests plans from `FlexPlanner`, which composes scenario-aware graphs (LinkedIn, blog, generic) by combining capability metadata, facet contracts, and planner drafts. Validation handled by `PlannerValidationService`.
  3. Streams `FlexEvent` frames (`start`, `plan_requested`, `plan_generated`, node lifecycle, HITL events) over SSE with `createSse`.
  4. Executes nodes through `FlexExecutionEngine`, invoking agent runtimes and enforcing HITL pauses (`HitlService`) plus replan triggers (`ReplanRequestedError`).
- **Capabilities & agents**:
  - `StrategyManagerAgent` registers asset analysis and knob planning tools (`src/tools/strategy.ts`) backed by DB assets and knob heuristics.
  - `ContentGeneratorAgent` wraps OpenAI structured outputs with LinkedIn-specific instructions, facet contracts, and optional HITL escalation (`src/agents/content-generator.ts`).
  - `QualityAssuranceAgent` (see `src/agents/quality-assurance.ts`) performs rubric scoring and compliance checks, emitting recommendations for revisions.
  - Capability metadata stored in Postgres via `FlexCapabilityRegistryService` (`src/services/flex-capability-registry.ts`), including heartbeat-based activity tracking and facet compilation.
- **Tooling**: `AgentRuntime` abstracts the OpenAI Agents SDK, aligning tool schemas with Zod validators and providing instrumentation hooks for tool calls/results. HITL tool wiring lives in `src/tools/hitl.ts`.
- **HITL**: `HitlService` persists requests/responses through `@awesomeposter/shared` contracts, enforces per-run quotas, and pushes SSE frames when operators must approve or deny content.
- **Sandbox & metadata**: `src/utils/flex-sandbox.ts` aggregates capability snapshots and sample TaskEnvelopes. `routes/api/v1/flex/sandbox/*.ts` return metadata to the SPA when `USE_FLEX_DEV_SANDBOX` is set.
- **Logging/telemetry**: `src/services/logger.ts` wraps Winston with correlation IDs; SSE writer emits `sse_backpressure` warnings when clients fall behind.

### Tests & Reference Implementation
- Flex has an extensive Vitest suite (`packages/flex-agents-server/__tests__/`) covering planner validation, capability registration, SSE framing, HITL workflows, sandbox metadata, and policy-gated replans. Notable specs:
  - `flex-planner.spec.ts` and `flex-planner-hybrid.spec.ts` verify scenario matching, facet contracts, and dynamic branching for marketing objectives.
  - `strategy` and `content` tool specs ensure asset analysis and knob planning align with marketing heuristics.
  - Integration specs (`flex-sandbox-run.spec.ts`, `hitl-api.integration.spec.ts`) simulate end-to-end runs, validating event streams against the reference TaskEnvelope shape.
- Shared package tests (`packages/shared/__tests__/flex/**`) guarantee schema and facet catalog consistency, acting as the canonical reference for downstream teams.

## External Integrations
- **OpenAI Agents SDK** (`@openai/agents`) drives structured tool invocation, with fallback to `openai` REST for non-agent tasks.
- **Redis (Upstash)** underpins feature-flag pub/sub and cache invalidation for multi-instance deployments.
- **S3-compatible storage** is expected for asset URLs (see `@aws-sdk/client-s3` usage in root app), though flex agents treat URLs as opaque.
- **IMAP intake** (`scripts/imap-poller.mjs`) persists briefs from email; generated briefs feed directly into flex workflows after approval.

## Technical Debt & Risks
- `WorkflowOrchestrator` (`packages/flex-agents-server/src/services/workflow-orchestrator.ts`) remains mostly a stub, returning echo responses; the orchestrated agent hand-off is still driven by `FlexRunCoordinator`, so duplication/confusion risk exists.
- Planner scenarios are hard-coded in `FlexPlanner`; adding new campaign types requires code changes instead of registry-driven configuration.
- Capability registry heartbeat metadata is stored per-row; drift between agent prompts and DB entries can break planner assumptions without automated sync jobs.
- HITL reliance on environment quotas (`HITL_MAX_REQUESTS`) lacks per-client granularity; overflows lead to auto-denials that may surprise operators.
- SSE concurrency/backlog is enforced in-process only; without horizontal coordination, multi-instance deployments risk overwhelming upstream services.
- `packages/flex-agents-server/node_modules` is vendored to keep the package self-contained, increasing repo weight and complicating dependency upgrades.

## Operational Notes
- **Local dev**: run `npm run dev:flex` with Postgres (`npm run db:up`); seed feature flags via `server/api/clients/[id]/feature-flags.patch.ts`. Flex sandbox toggled through `VITE_USE_FLEX_DEV_SANDBOX=true`.
- **Deployment**: Nitro build (`npm run build:flex`) produces `.output/server/index.mjs`. Runtime needs Node ≥20.19, Postgres, optional Upstash Redis, and OpenAI API keys.
- **Monitoring hooks**: Winston logs JSON to stdout; consider shipping to centralized logging to observe planner decisions (`flex_run_start`, `flex_plan_generated`, `hitl_request_*`).
- **Resumability**: runs stitch together by `threadId` (brief id) or explicit metadata; HITL resumes require preserving `runId` returned over SSE and calling the same endpoint with `constraints.resumeRunId`.

## Next Steps (Recommended)
1. **Harden WorkflowOrchestrator**: align stub class with real agent phases or remove to avoid divergent orchestration paths.
2. **Externalize planner scenarios**: persist scenario definitions in the capability registry or config, enabling runtime extensions without redeployments.
3. **Distributed concurrency control**: move SSE semaphore state to Redis or database to support multi-instance flex deployments.
4. **Automated capability sync**: add CI checks or migrations ensuring registry metadata mirrors agent code (prompt files, preferred models).
5. **HITL analytics**: persist escalation latency and outcomes to `postTelemetry` or dedicated tables, enabling QA on human overrides.

## Useful Commands & References
```bash
# Launch flex server locally
npm run dev:flex

# Run targeted flex tests
npm run test:unit -- packages/flex-agents-server/__tests__/flex-planner.spec.ts

# Update DB schema
npm --prefix packages/db run gen && npm --prefix packages/db run push
```

- **Key assets**:
  - Flex architecture spec (`docs/architecture/flex-agents-server.md`)
  - Functional specs (`agentic_ai_social_poster_functional_specs.md`)
  - Shared contracts (`packages/shared/src/flex/types.ts`)
  - Planner tests (`packages/flex-agents-server/__tests__/flex-planner.spec.ts`)

