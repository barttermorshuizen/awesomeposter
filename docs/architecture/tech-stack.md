# Tech Stack Overview

AwesomePoster is a multi-service TypeScript workspace built around a Vue SPA, a Nitro API deployment, and an OpenAI Agents orchestration server. This document captures the supported technologies and how they fit together.

## 1. Core Runtime Components

| Layer | Tech | Notes |
| --- | --- | --- |
| Frontend | **Vue 3** (Composition API), **Vite 7**, **Vuetify 3** | SPA located in `src/`; Vuetify provides design system components. |
| State | **Pinia 3** | Global state stores under `src/stores`. |
| Routing | **vue-router 4** | Route modules in `src/router`. |
| Styling | **Sass** (optional) + Vuetify utility classes | Scoped styles in SFCs; global overrides via Vuetify theme. |
| API | **Nitro 2** (Nitropack) | Lives under `server/`; provides REST endpoints & jobs. |
| Agents | **OpenAI Agents SDK 0.1** + **OpenAI 5.x** | Implemented in `packages/agents-server`; orchestrates specialist agents with SSE streaming. |
| Persistence | **Drizzle ORM 0.44** + **Postgres** | Schema/migrations in `packages/db`. |
| Object Storage | **Cloudflare R2 (S3-compatible)** | Managed via `@aws-sdk/client-s3` & presigner helpers. |
| Email Intake | **imapflow** + custom scripts | Ingest pipeline defined under `scripts/imap-poller.mjs`. |

## 2. Packaging & Workspace Layout

- Root project uses npm workspaces with local packages:
  - `@awesomeposter/shared`: shared models/utilities (framework-agnostic).
  - `@awesomeposter/db`: Drizzle schema + migrations (consumed by API & agents server).
  - `@awesomeposter/agents-server`: orchestrator service packaged with Nitropack.
- SPA, API, and agents server share the same Node version requirement (`^20.19 || >=22.12`).

## 3. Tooling & Quality Gates

- **TypeScript**: `~5.8`. Dedicated `tsconfig` files for app, server, packages.
- **Linting**: ESLint flat config (`eslint.config.ts`) with Vue + TypeScript + Vitest plugins. Command: `npm run lint`.
- **Testing**: Vitest (`npm run test:unit`). Vue Test Utils for component tests; Node logic uses plain Vitest.
- **Build**:
  - SPA: `npm run build` (delegates to Vite).
  - Agents server: `npm run build:agents` (Nitropack build).
  - API: `npm run build:api`.
- **Type-checking**: `npm run type-check` (vue-tsc).

## 4. Environment & Configuration

- `.env` keys consumed by SPA via Vite `import.meta.env`, and by servers via Nitro runtime/`dotenv`:
  - `OPENAI_API_KEY`, `OPENAI_DEFAULT_MODEL`, `API_KEY` (server auth), `VITE_AGENTS_BASE_URL`, `VITE_AGENTS_AUTH_BEARER`, etc.
- Agents server supports SSE tuning (`SSE_CONCURRENCY`, `SSE_MAX_PENDING`).
- Feature flags (e.g., HITL rollout) should use env-driven configuration published through shared config modules.

## 5. Deployment Targets (baseline)

- **Frontend**: Vite build suitable for Vercel or similar static hosting.
- **Nitro API**: Deployable to Vercel functions or Node serverless targets.
- **Agents Server**: Node process (Nitro) behind SSE-friendly runtime (e.g., Vercel Edge with streaming or Node server on Cloud Run).
- **Database**: Postgres (Neon/Supabase). Drizzle migrations executed prior to deploy.
- **Object Storage**: Cloudflare R2 (S3-compatible API).

## 6. Observability & Logging

- **Winston** on agents server for structured logs.
- Nitro uses built-in logging; extend with Winston or console wrappers as needed.
- SSE telemetry from agents server includes run phases, handoffs, and QA results; consumers must handle stream parsing.

## 7. External Integrations

- **Mailgun / IMAP**: Inbound email ingestion via `imapflow` script.
- **Google APIs**: Placeholder dependency for future integrations (no active usage yet).

Keep this document updated when upgrading major packages or introducing new infrastructure so downstream teams (DevOps, QA, Product) understand the supported stack.
