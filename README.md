# AwesomePoster

Agents-driven social content orchestrator with SSE streaming and specialist agents.

This repository contains both the web app (Vite + Vue) and the Agents Server (Nitro) powering the orchestrated workflow.

See the orchestration design in `docs/orchestrator_requirements.md` and the refactor plan in `docs/orchestrator-as-code.md`.

## Quickstart

- Install dependencies
  - `npm install`

- Environment
  - Set `OPENAI_API_KEY` for the Agents SDK
  - Optional: `API_KEY` to protect server routes in production (Bearer token)
  - Optional: see “Agents Server Environment” below for additional tuning

- Run dev
  - `npm run dev`
  - Web app: http://localhost:5173
  - Agents server: http://localhost:3002

## Agents Server Environment

- OPENAI_API_KEY: required in production; in dev the server will warn if missing
- OPENAI_DEFAULT_MODEL or OPENAI_MODEL: optional model override (defaults to a sensible fallback). Set to `gpt-5` to switch agents to GPT‑5.
- API_KEY: optional bearer token required in production (enforced by `packages/agents-server/server/middleware/auth.ts`)
- LOG_LEVEL: optional log level (default `info`)
- ENABLE_CHAT_SANDBOX: set to `true` to allow chat mode in production (chat is allowed by default in dev)
- SSE_CONCURRENCY: maximum concurrent SSE streams (default `4`)
- SSE_MAX_PENDING: backlog limit for waiting SSE streams (default `32`)

Client (web app) environment:
- VITE_AGENTS_BASE_URL: base URL for the agents server (default `http://localhost:3002`)
- VITE_AGENTS_AUTH_BEARER: optional bearer token sent to the Agents Server

## Streaming API

POST `POST /api/v1/agent/run.stream` with JSON body:
- `mode`: `'app' | 'chat'`
- `objective`: string
- `threadId?`: optional. Provide a stable id to enable resume across runs
- `options?`: per-run options (tool policy, allowlist, etc.)

Response is Server‑Sent Events. Key frames in app mode:
- `start`, `phase`, `plan_update`, `handoff`, `delta` (generation/qa only), `tool_call`, `tool_result`, `metrics`, `message`, `error`, `complete`
- Final payload shape: `{ result, quality, acceptance-report }`
- A `message` frame with `message: "run_report"` is emitted just before `complete` and contains the full run report

Minimal curl example:

```sh
curl -N \
  -H 'Content-Type: application/json' \
  -H 'Accept: text/event-stream' \
  -d '{"mode":"app","objective":"Create an engaging LinkedIn post about our launch.","threadId":"th_demo_1"}' \
  http://localhost:3002/api/v1/agent/run.stream
```

## Resuming Runs

- Provide a stable `threadId` in your request to enable deterministic resumption.
- To resume, call the same route again with the same `threadId`. The server restores the last known plan and history.
- Omit `threadId` (or use a new one) to start fresh.

## Scripts

- Dev: `npm run dev`
- Build: `npm run build`
- Unit tests: `npm run test:unit`
- Lint: `npm run lint`
