# AwesomePoster

AwesomePoster is a multi-agent social content operations platform. The repo bundles the Vue 3 operator console, a Nitro API for workflow and asset management, an OpenAI Agents-based orchestration server, and the Drizzle/Postgres schema that keeps everything in sync.

Key design docs live under `docs/` (start with `docs/orchestrator_requirements.md`, `docs/new_agent_architecture.md`, and `docs/orchestrator-as-code.md`).

## Architecture at a Glance
- **Web app (`src/`)** – Vite + Vue 3 + Vuetify UI for briefs, clients, human-in-the-loop approvals, and the sandbox runner. Pinia stores coordinate with the API and the agents server.
- **Nitro API (`server/`)** – REST endpoints for clients, briefs, assets, task inbox, HITL run management, Mailgun webhook ingestion, and agent workflow triggers. Running at port `3001` in dev.
- **Agents server (`packages/agents-server/`)** – Nitro runtime that exposes Server-Sent Event (SSE) streaming endpoints for create-post orchestration (plan → draft → critique → revise), handles operator pauses/resumes, and stores telemetry.
- **Database package (`packages/db/`)** – Drizzle ORM schema + migrations targeting Neon Postgres. Re-exported helper functions (`getDb`, `getPool`) are consumed by both Nitro servers.
- **Shared package (`packages/shared/`)** – Zod schemas, DTOs, feature flag helpers, and typed responses shared across UI, API, and orchestrator.
- **Operational tooling (`scripts/`)** – Feature flag CLI, IMAP email poller, Gmail OAuth helper, and other one-off utilities referenced in `imap-polling-readme.md`.

## Current Status
- **Brief management** – List, create, edit, approve, and delete briefs. Backed by `server/api/briefs/*` handlers and surfaced in `src/views/Briefs*.vue`.
- **Client profiles** – Full CRUD for client metadata plus tone/objective JSON fields (`src/views/Clients*.vue`, `server/api/clients/*`). Feature flag helpers allow per-client toggles via `client_features`.
- **Create-post orchestration** – UI integrates with the agents server through `AgentResultsPopup` and the `useHitlStore`. Operators can resume/remove suspended runs and respond to HITL prompts.
- **Asset ingest** – API endpoints exist for uploading/listing assets (targets R2/S3). UI screen is still a placeholder until design sign-off; backend ready for integration tests.
- **Discovery pilot** – Discovery SSE stream, source CRUD, and ingestion jobs are scaffolded behind feature flags (`DISCOVERY_ENABLE`). Docs under `docs/discovery-agent-dev-setup.md`.
- **Analytics & Inbox** – Routes exist with placeholder copy so QA can visualize intended flows; dashboard metrics, inbox filtering, and analytics rollups are in progress.

## Prerequisites
- **Node.js** `^20.19.0` or `>=22.12.0` (matches engines field). Use npm 10 bundled with Node 20+.
- **Postgres** – Neon (recommended) or any Postgres instance reachable from dev/prod. SSL is required in hosted environments.
- **Optional integrations** depending on workflow: Cloudflare R2 or S3-compatible storage, Upstash Redis, Mailgun or IMAP credentials, OpenAI API access.

## Environment Setup
The repo consumes environment variables from `.env` at the project root (loaded by both Vite and Nitro). The agents server reads the same values; you can symlink or copy `.env` into `packages/agents-server/.env` if you prefer scoped files.

### Base `.env` example
```bash
# Core services
DATABASE_URL=postgresql://<user>:<password>@<host>/<database>?sslmode=require
OPENAI_API_KEY=sk-...
API_KEY=dev-token-123               # Enforces bearer auth when set

# Web client
VITE_AGENTS_BASE_URL=http://localhost:3002
VITE_AGENTS_AUTH_BEARER=dev-token-123

# Optional storage / integrations
R2_ENDPOINT=https://...
R2_ACCESS_KEY=...
R2_SECRET_KEY=...
R2_BUCKET_RAW=awesomeposter-raw
R2_BUCKET_ASSETS=awesomeposter-assets
QUEUE_URL=https://...
APP_BASE_URL=http://localhost:5173
```

### Neon Postgres configuration
1. Create a project in [Neon](https://neon.tech/), add a branch (e.g., `dev`), and create a database (defaults are fine).
2. Open the connection string from the **psql** tab, switch the protocol to `postgresql://`, and append `?sslmode=require` (Neon enforces TLS).
3. Paste the string into `DATABASE_URL` for both the Nitro API and the agents server (shared `.env` works).
4. Enable the `pgcrypto` and `uuid-ossp` extensions on the branch if you plan to run the full migration set:
   ```bash
   psql "$DATABASE_URL" -c 'create extension if not exists "uuid-ossp";'
   psql "$DATABASE_URL" -c 'create extension if not exists pgcrypto;'
   ```
5. Apply schema changes from the `packages/db` package:
   ```bash
   cd packages/db
   npm install                  # first-time only inside the package
   npm run push                 # drizzle-kit push --config=./drizzle.config.ts
   cd ../..
   ```
6. If you need to regenerate SQL (after editing the schema) run `npm run gen` within `packages/db`.

### Optional variables
| Variable | Purpose |
| --- | --- |
| `MAILGUN_SIGNING_KEY` | Validates inbound Mailgun webhooks for email-to-brief ingestion. |
| `ENABLE_CHAT_SANDBOX` | When `true`, agents server exposes `/api/v1/chat` sandbox endpoints in production. |
| `LOG_LEVEL` | Controls agents server logging (`info` default). |
| `SSE_CONCURRENCY` / `SSE_MAX_PENDING` | Tune streaming concurrency/backlog for agents server. |
| `DISCOVERY_ENABLE` | Gate discovery pilot UI/API routes. |
| `DISCOVERY_API_KEY` | Required when discovery routes are enabled. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Used by optional caching utilities. |

## Local Development
Install dependencies once:
```bash
npm install
```
Run only what you need, or use the orchestration helpers:
- `npm run dev:app` – Vite dev server on `http://localhost:5173`.
- `npm run dev:api` – Nitro API on `http://localhost:3001`.
- `npm run dev:agents` – Agents server on `http://localhost:3002`.
- `npm run dev:both` – Vite + agents server in parallel.
- `npm run dev:all` – Spins up SPA, Nitro API, agents server, and shared package watch tasks.

The SPA expects both the API (`3001`) and agents server (`3002`) when exercising end-to-end flows.

## Database & Migrations
- Apply new migrations: `cd packages/db && npm run push` (Drizzle will diff the schema against Neon).
- Generate SQL from schema changes: `npm run gen` inside `packages/db`.
- Type build for shared contracts: `npm run build` at repo root includes `tsc --build` and Vite build.

## Testing & Quality
- `npm run test:unit` – Vitest suite covering stores, composables, agents helpers.
- `npm run lint` – ESLint across the monorepo (`--fix` by default).
- `npm run type-check` – Vue TSC project references for SPA + Nitro API.

## Agents Streaming API
The agents server exposes SSE endpoints under `/api/v1/agent/*`. The primary workflow is `run.stream`:

```bash
curl -N \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -H 'Authorization: Bearer dev-token-123' \
  -d '{
    "mode": "app",
    "objective": "Create an engaging LinkedIn post about our new AI-driven reporting module.",
    "threadId": "brief_12345"
  }' \
  http://localhost:3002/api/v1/agent/run.stream
```

Event frames include `start`, `phase`, `plan_update`, `handoff`, `delta`, `tool_call`, `tool_result`, `metrics`, `message`, and `complete`. HITL pauses emit `message` frames with `message: "hitl_request"`; operators resume via the SPA or `/api/hitl/resume` endpoint.

Pass the same `threadId` to resume a suspended run. Omitting it starts a new orchestration.

## Operational Tooling
- `npm run imap:poller` – Development-only IMAP poller (see `imap-polling-readme.md`).
- `npm run flags` – CLI for reading/updating per-client feature flags.
- `npm run gmail-generate-refresh-token` – Helper to obtain Gmail OAuth refresh tokens for IMAP polling.

## Further Reading
- Functional specs: `agentic_ai_social_poster_functional_specs.md`
- Technical design notes: `agentic_ai_social_poster_technical_design.md`
- Human-in-the-loop runbook: `docs/orchestrator-hitl-runbook.md`
- Discovery pilot onboarding: `docs/discovery-agent-dev-setup.md`
- Discovery scoring implementation: `docs/discovery-scoring-implementation-notes.md`
- Reviewer scoring guide: `docs/discovery-scoring-reviewer-guide.md`

Keep the README in sync with the codebase; update the sections above when capabilities graduate from TODO to production-ready.
