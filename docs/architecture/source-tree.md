# Source Tree Guide

Reference for contributors to understand where functionality lives. Paths are relative to the repo root.

## 1. Top-Level

| Path | Purpose |
| --- | --- |
| `src/` | Vue 3 SPA (components, views, stores, router, lib utilities, tests). |
| `server/` | Nitro API routes (`api/`), background jobs, middleware, shared utilities. |
| `packages/` | Workspace packages (`agents-server`, `db`, `shared`). |
| `docs/` | Product/architecture documentation (PRD, epic/story shards, architecture references). |
| `tests/` | Cross-cutting test utilities and manual experiments (if any). |
| `scripts/` | Operational scripts (e.g., IMAP poller). |
| `public/` | Static assets served by Vite. |
| `tokens/` | Design tokens / placeholder assets. |

## 2. SPA (`src/`)

- `App.vue`, `main.ts`: App bootstrap, Vuetify/Vue Router wiring.
- `components/`: Reusable UI components (e.g., `MainLayout.vue`, `AgentResultsPopup.vue`, `KnobSettingsDisplay.vue`).
- `views/`: Route-level screens; align with router configuration.
- `router/`: Route definitions, guards, navigation helpers.
- `stores/`: Pinia stores (UI state, domain caches).
- `lib/`: Client-side utilities (API clients, formatting helpers).
- `__tests__/`: Component/unit tests colocated with SPA tree.

## 3. Nitro API (`server/`)

- `api/`: REST handlers implemented with `defineEventHandler` per route.
- `jobs/`: Scheduled/background job definitions.
- `middleware/`: Request/response middleware (auth, logging).
- `utils/`: Shared helpers for API layer (validation, config loaders).
- `shims/`: Compatibility shims or type augmentations.

## 4. Agents Server (`packages/agents-server`)

- `src/orchestrator/`: Orchestrator flows, HITL logic, plan management.
- `src/server/`: Runtime wiring, persistence services, telemetry.
- `routes/`: API endpoints exposed by the agents server (SSE streaming, admin hooks).
- `__tests__/` & `tests/`: Vitest suites for orchestrator and API behaviors.
- `nitro.config.ts`: Build/runtime configuration for agents server deployment.

## 5. Shared Libraries

- `packages/shared/src/`: Cross-tier utilities, domain models, validation schemas.
- `packages/db/src/`: Drizzle ORM schema definitions, migrations, and DB helpers.
- `packages/db/migrations/`: SQL migration files generated via Drizzle.

## 6. Documentation Assets

- `docs/prd/`: Sharded PRD & epic files (e.g., `epic-1-hitl.md`).
- `docs/stories/`: Story documents aligned with PRD epics.
- `docs/architecture/`: Architecture references (this folder).
- Additional design/plan docs (e.g., `docs/orchestrator_requirements.md`, `hardening_agent_server.md`).

## 7. Configuration & Tooling Files

- `package.json`, `package-lock.json`: Workspace definitions.
- `eslint.config.ts`: Global lint configuration.
- `tsconfig*.json`: TypeScript compiler options for different targets.
- `vite.config.ts`, `nitro.config.ts`: Build/toolchain entries.
- `vitest.config.ts`, `tsconfig.vitest.json`: Testing configuration.

Keep this guide updated when new packages or major directories are introduced. If adding a new domain area, document its location and link it to relevant stories/PRDs for traceability.
