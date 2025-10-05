# Discovery Agent Developer Setup & API Handoff

## Purpose
Provide engineers a single entry point for spinning up the discovery agent stack locally, understanding service boundaries, and integrating APIs safely without breaking the existing AwesomePoster experience.

## Audience
- Backend, frontend, and platform engineers implementing discovery epics.
- QA and release engineers validating end-to-end flows.

---

## 1. Environment Prerequisites
- **Node.js**: v20 LTS (check with `node --version`).
- **PNPM**: v9.x (install via `corepack enable` if needed).
- **Postgres**: local instance (14+) or Docker container; replica must include extensions `pgcrypto`, `uuid-ossp`.
- **Redis (optional)**: only required when load-testing SSE; default dev boot uses in-memory mock.
- **YouTube API key** (Discovery) stored in `.env.discovery.local`; see [Credentials](#5-credentials--secrets).

> Tip: Use `scripts/dev/start-services.sh` (to be added) to spin up Postgres + Redis via Docker Compose.

### Repo Bootstrap
```bash
pnpm install
pnpm run build:types # ensures shared contracts compile before first dev server start
```

### Environment Files
- Copy `.env.example` to `.env.local` for the SPA and Nitro, then append discovery vars from table below.
- Agents server uses `packages/agents-server/.env.local` (copy from `.env.example`).

| Variable | Location | Purpose |
| --- | --- | --- |
| `DISCOVERY_ENABLE` | `.env.local`, `server/.env` | Feature flag to expose discovery routes/UI. Default `false`. |
| `DISCOVERY_API_KEY` | `server/.env` | Bearer token for Nitro discovery endpoints; reuse existing API auth helpers. |
| `YOUTUBE_API_KEY` | `.env.discovery.local` | Required for YouTube channel polling. |
| `DISCOVERY_SSE_ORIGIN` | `.env.local` | Base URL for SSE connections (`http://localhost:3000`). |
| `DATABASE_URL_DISCOVERY` | `packages/db/.env` | Points to discovery-aware schema (same database, different schema). |

---

## 2. Local Services & Commands
| Component | Command | Notes |
| --- | --- | --- |
| Nitro API | `pnpm run dev:server` | Serves `/api/discovery/*`, uses Vite env vars. |
| Vue SPA | `pnpm run dev` | Discovery routes gated behind `DISCOVERY_ENABLE`. |
| Agents Server | `pnpm run dev:agents` | Runs orchestration, scoring, telemetry emitters. |
| Background Jobs | `pnpm run dev:jobs -- discovery` | Schedules ingestion (Story 3.1) when feature flag enabled. |
| Drizzle Migrations | `pnpm run db:migrate --filter discovery` | Applies additive tables (`discovery_sources`, etc.). |
| Vitest | `pnpm test --filter discovery` | Aggregated test suite for discovery modules (see Section 4). |

Bring services up in this order to ensure migrations apply before jobs emit events.

---

## 3. API Contracts & Routes
### Nitro (REST)
| Route | Method | Description | Auth |
| --- | --- | --- | --- |
| `/api/discovery/sources` | GET/POST/PATCH/DELETE | CRUD for client sources. | `Authorization: Bearer <DISCOVERY_API_KEY>` |
| `/api/discovery/briefs` | GET | Filterable briefs list. | Same as above |
| `/api/discovery/briefs/:id/promote` | POST | Promote brief to `Approved`. | Same |
| `/api/discovery/briefs/:id/archive` | POST | Archive brief with note. | Same |
| `/api/discovery/events.stream` | GET (SSE) | Real-time telemetry (ingestion, scoring). | Cookie + bearer |

Contracts live in `packages/shared/src/schemas/discovery.ts`. Update schema first, regenerate types (`pnpm run build:types`), then confirm Nitro + SPA compile.

### Agents Server Hooks
- `DiscoveryIngestionJob` → pulls from `discovery_sources`, enqueues normalized items.
- `DiscoveryScoringAgent` → scores items, emits SSE events (`brief.scored`, `duplicate.suppressed`).
- `DiscoveryTelemetryPublisher` → writes aggregated metrics to `discovery_metrics`.

Add new capabilities behind `DISCOVERY_ENABLE` and wrap with feature-flag guard helpers in `packages/shared/src/config.ts`.

---

## 4. Testing Strategy
| Layer | Tooling | Minimum Coverage |
| --- | --- | --- |
| Unit | Vitest + Vue Test Utils | Store logic, composables, API helpers. |
| Integration | Nitro + Supertest | Source CRUD, ingestion webhooks, SSE handshake. |
| End-to-End | Playwright smoke (opt-in) | UI validation for forms, filters, SSE reconnects. |
| Load/Regression | k6 or artillery (optional) | Validate SSE & ingestion concurrency before pilot. |

Add new tests under:
- `tests/server/discovery/*.test.ts` for Nitro handlers.
- `tests/agents/discovery/*.test.ts` for orchestrator workflows.
- `tests/ui/discovery/*.spec.ts` for SPA components.

> Ensure fixtures include sample RSS/YouTube payloads in `tests/fixtures/discovery/`.

---

## 5. Credentials & Secrets
- Store API keys in 1Password vault `AwesomePoster / Discovery Agent`.
- Add onboarding ticket for platform to provision YouTube quota before sprint start.
- Local developers fetch credentials via `scripts/credentials/fetch-discovery.sh` (to be built) and inject into `.env.discovery.local`.
- Nitro server reads `DISCOVERY_API_KEY` from environment only; do not commit to repo or .env.example.

---

## 6. Release & Rollback Checklist (Developer View)
1. Run `pnpm run db:migrate --filter discovery` in staging, verify `discovery_*` tables exist.
2. Deploy Nitro + SPA with `DISCOVERY_ENABLE=false` (shadow mode). Validate no runtime errors.
3. Toggle feature flag for staging pilot client via `pnpm run flags:set discovery --client <id> --enabled`.
4. Verify ingestion job completes without errors, SSE streaming works.
5. Promote to production with flag disabled.
6. Post-release, enable flag for internal pilot only. Monitor logs/metrics (see operator runbook).
7. **Rollback**: disable feature flag (immediate), redeploy previous Nitro/SPA if needed, revert migrations using `pnpm run db:rollback --filter discovery` only if necessary and confirmed no data needed.

Document deployment status in `docs/plans/discovery-agent-sprint-plan.md` under Sprint Notes.

---

## 7. Contacts & Ownership
| Area | Primary | Backup |
| --- | --- | --- |
| Nitro APIs | Backend owner (TBD) | Platform engineer |
| SPA/UI | Frontend owner | UX engineer |
| Agents Server | Orchestrator lead | Platform engineer |
| Database/Migrations | Platform engineer | Backend owner |
| Feature Flags | PM / Platform | DevOps |

Keep this document updated each sprint; major changes require PR review by PM and architect.

---

## 8. Scheduled Ingestion Runbook
- **Cadence & Persistence**: each discovery source persists its cadence in `discovery_sources.fetch_interval_minutes` (default 60). The scheduler reads `next_fetch_at` and atomically advances it alongside telemetry writes so restarts never double-trigger. Update intervals per client via admin tooling or direct SQL (`UPDATE discovery_sources SET fetch_interval_minutes = 30 WHERE id = …`).
- **Worker Pool Guardrails**: concurrency is controlled by `DISCOVERY_INGEST_WORKERS` (default 3). Increase temporarily for large HTTP/RSS backfills; keep YouTube pools at ≤3 to avoid quota bursts. Scheduler skips sources already marked `last_fetch_status = 'running'` to prevent overlapping runs.
- **Adapter Routing**: HTTP/web pages and RSS feeds share the HTTP adapter; RSS parsing honours canonicalization hints and runs safely at 30–60 minute cadences. YouTube channels/playlists use the YouTube adapter, which respects API quotas and maps 403/429 errors to `youtube_quota` failures (triggering retry/backoff via Story 3.3).
- **Telemetry & Observability**: each run emits `ingestion.started`, `ingestion.completed`, and (on final failure) `ingestion.failed` events (SSE + logs). Payloads now include attempt counters, retry/backoff minutes, `nextRetryAt`, and failure taxonomy so dashboards can chart consecutive failures without extra queries. Use these events to confirm RSS cadences (expect steady 60-minute spacing) and YouTube cadence adjustments (longer intervals during quota scarcity).
- **Failure Handling**: structured telemetry captures `network_error`, `http_4xx`, `http_5xx`, `youtube_quota`, and more. Transient issues auto-retry up to 3 attempts with exponential backoff (1, 2, 4 minutes by default, capped at 15), honoring `Retry-After` headers on 429 responses. When monitoring, investigate repeated `youtube_quota` within a 24h window—lower cadence or rotate credentials. RSS failures with `http_5xx` now emit `ingestion.failed` after retries exhaust; permanent failures (non-429 `http_4xx` and unknown errors) publish a `source.health` SSE event marked `error` so the Source Health dashboards surface the outage alongside `nextRetryAt`/attempt metadata for operators.
- **Restart Playbook**: when redeploying or restarting jobs, verify scheduler health with `SELECT id, last_fetch_status, next_fetch_at FROM discovery_sources ORDER BY next_fetch_at LIMIT 10;` ensuring no rows are stuck in `running`. If stuck, reset with `UPDATE discovery_sources SET last_fetch_status = 'idle' WHERE last_fetch_status = 'running';` before re-enabling cron.
