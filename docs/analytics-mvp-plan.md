# Analytics MVP Implementation Plan — Knob-centric, Cohort-first (LinkedIn CSV)

Scope
- Objective: Ground Strategy Manager’s knobs in real LinkedIn analytics from similar posts (same objective + embeddings-derived topic), using CSV uploads (MVP).
- Output: A recommended 4‑knob vector with expected lift and confidence, plus evidence (per‑knob bin curves and format-type deltas).
- Integrations: Strategy tool and instructions; Orchestrator payload; light enforcement in Content and QA.

Non-goals (MVP)
- Live LinkedIn API ingestion (CSV-only).
- Audience matching (added in Phase 2).
- Multivariate models and pairwise interaction surfaces (Phase 2).
- Cross-client benchmarks (Phase 2+).

Architecture Reference
See architecture details and diagrams in [awesomeposter/docs/analytics-mvp-arch.md](awesomeposter/docs/analytics-mvp-arch.md).

Relevant integration points (code already in repo)
- Strategy agent creation and allowlist: [TypeScript.createStrategyAgent()](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts:77)
- Strategy instructions (APP): [TypeScript.STRATEGY_INSTRUCTIONS_APP](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts:15)
- Strategy tools entrypoint: [TypeScript.registerStrategyTools()](awesomeposter/packages/agents-server/src/tools/strategy.ts:132)
- Orchestrator payload builder: [TypeScript.buildPayloadForCapability()](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts:317) and runner [TypeScript.runOrchestratorEngine()](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts:237)
- Content optimization tools (enforcement): [awesomeposter/packages/agents-server/src/tools/content.ts](awesomeposter/packages/agents-server/src/tools/content.ts)
- QA tools (validation): [awesomeposter/packages/agents-server/src/tools/qa.ts](awesomeposter/packages/agents-server/src/tools/qa.ts)
- Asset upload (CSV ingestion path already exists): [awesomeposter/server/api/assets/upload.post.ts](awesomeposter/server/api/assets/upload.post.ts)

Milestones and deliverables

M0 — Contracts and defaults (1 day)
- Add shared types file for insights:
  - New file: [awesomeposter/packages/shared/src/insights.ts](awesomeposter/packages/shared/src/insights.ts)
  - Expose from [awesomeposter/packages/shared/src/index.ts](awesomeposter/packages/shared/src/index.ts)
  - Types:
    - PlatformInsightsRequest { platform: 'linkedin'; clientId; briefId?; objective; topicHint?; timeframeDays: 90; kpi: 'engagement_rate'; csvAssetId?; columnMap? }
    - PlatformInsights { cohortDescriptor; knobInsights; postingTimes?; mediaRecommendation?; benchmarkEvidence[]; complianceNotes? }
    - knobInsights: { recommended knobs; expectedLiftPct; confidence; evidence: { univariate bins; formatType deltas }; notes? }
- Lock defaults (approved):
  - Embeddings: OpenAI text-embedding-3-small; textWindow=first 300 chars
  - Topic k in 6–12 via silhouette; merge clusters below min size
  - Sample thresholds: cohort ≥ 80 posts; per-bin ≥ 25 posts or ≥ 1k impressions
  - Exclude boosted posts; cache TTL 24h; fallback to objective-only heuristics

M1 — DB migration + cache skeleton (0.5–1 day)
- Migration: platform_insights_cache
  - New migration: [awesomeposter/packages/db/drizzle/0008_platform_insights_cache.sql](awesomeposter/packages/db/drizzle/0008_platform_insights_cache.sql)
  - Schema addition: [awesomeposter/packages/db/src/schema.ts](awesomeposter/packages/db/src/schema.ts)
    - platform_insights_cache: { id, clientId, platform, paramsHash, timeframeDays, kpi, payloadJson, evidenceJson, source: 'csv', createdAt, expiresAt, unique(clientId, platform, paramsHash) }
- Accessors:
  - Add get/set helpers in [awesomeposter/packages/db/src/index.ts](awesomeposter/packages/db/src/index.ts)

M2 — Embeddings client (0.5–1 day)
- Server-side OpenAI embeddings client with batching and rate limiting (reuse OPENAI_API_KEY).
- Caching layer (in-memory LRU) keyed by (csvAssetId+rowHash) → embedding vector.
- Respect provider limits (backoff/retry, concurrency guard).

M3 — CSV adapter and column mapping (0.5 day)
- New: [awesomeposter/packages/agents-server/src/services/insights/adapters/csv.ts](awesomeposter/packages/agents-server/src/services/insights/adapters/csv.ts)
  - load(assetId, columnMap?): returns rows with normalized fields:
    - created_at, text, impressions, reactions, comments, shares, clicks, media_type, is_boosted?, see_more_expands?
  - Validation and helpful errors for missing columns (suggest columnMap usage).

M4 — Cohort builder with embeddings clustering (1 day)
- New: [awesomeposter/packages/agents-server/src/services/insights/engine/cohort.ts](awesomeposter/packages/agents-server/src/services/insights/engine/cohort.ts)
  - Steps:
    - Extract first 300 chars for topic text per row; fetch embeddings (batched).
    - k-means with k in 6–12 using silhouette; merge small clusters; pick topicCluster for objective scope.
    - Build cohortDescriptor { platform, objective, topicCluster, topicMethod='embedding_cluster', timeframeDays, sampleSize }.
    - Exclude boosted posts for KPI estimation (keep counts for evidence only).

M5 — Knob inference (1 day)
- New: [awesomeposter/packages/agents-server/src/services/insights/engine/knob-inference.ts](awesomeposter/packages/agents-server/src/services/insights/engine/knob-inference.ts)
  - Infer per row:
    - formatType from media_type → enum { text, single_image, multi_image, document_pdf, video }
    - hookIntensity: opener features (numbers, percent, question, contrarian markers, imperative starts, first-line length band), clamp 0..1
    - expertiseDepth: jargon density (long tokens), how-to patterns, tool/library markers; clamp 0..1
    - structure.lengthLevel: percentile of first-line length versus cohort; 0..1
    - structure.scanDensity: line breaks and bullets per 200 chars → logistic; 0..1
  - Centralize calibration constants for repeatability and future tuning.

M6 — Knob performance engine and recommendation (1–1.5 days)
- New: [awesomeposter/packages/agents-server/src/services/insights/engine/knob-lifts.ts](awesomeposter/packages/agents-server/src/services/insights/engine/knob-lifts.ts)
  - Compute impressions-weighted KPI per bin across each knob dimension; enforce per-bin minimums; pooled variance or bootstrap CI; mark unstable bins.
- New: [awesomeposter/packages/agents-server/src/services/insights/engine/recommendation.ts](awesomeposter/packages/agents-server/src/services/insights/engine/recommendation.ts)
  - Select recommended knob vector (consider CI overlap and neighbor bins); compute expectedLiftPct and confidence; assemble evidence (univariate, formatType deltas).

M7 — Insights service + tool surface (0.5 day)
- New: [awesomeposter/packages/agents-server/src/services/insights/service.ts](awesomeposter/packages/agents-server/src/services/insights/service.ts)
  - getOrComputeInsights(req): paramsHash → cache get → CSVAdapter → cohort → inference → lifts → recommendation → cache set → return.
- Tool registration:
  - Add strategy_get_platform_insights in [TypeScript.registerStrategyTools()](awesomeposter/packages/agents-server/src/tools/strategy.ts:132) with strict zod params (required+nullable style) returning PlatformInsights.

M8 — Strategy orchestration and instructions (0.5 day)
- Allowlist: include 'strategy_get_platform_insights' in [TypeScript.createStrategyAgent()](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts:77).
- Instructions update in [TypeScript.STRATEGY_INSTRUCTIONS_APP](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts:15):
  - “Call strategy_get_platform_insights first (platform=linkedin, kpi=engagement_rate, timeframeDays=90, objective + topic hint). Adopt knobInsights.recommended for knobs; set writerBrief.constraints accordingly; cite evidence (lift%, n, confidence).”
- Orchestrator payload: enrich Strategy payload with { briefId, clientId?, objective, topicHint?, platform: 'linkedin' } in [TypeScript.buildPayloadForCapability()](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts:317).

M9 — Content & QA enforcement (0.5 day)
- Content: in [awesomeposter/packages/agents-server/src/tools/content.ts](awesomeposter/packages/agents-server/src/tools/content.ts), honor recommended first-line length band and scan density where constraints are passed (light nudges).
- QA: in [awesomeposter/packages/agents-server/src/tools/qa.ts](awesomeposter/packages/agents-server/src/tools/qa.ts), compute realized knobs from the draft and warn if outside recommended ranges (include expected impact deltas).

M10 — API route (optional helper) and UI evidence (1 day)
- Agents-server route (optional) to compute insights given a csvAssetId:
  - New: [awesomeposter/packages/agents-server/routes/api/v1/insights/ingest-csv.post.ts](awesomeposter/packages/agents-server/routes/api/v1/insights/ingest-csv.post.ts)
- UI evidence: update [awesomeposter/src/components/AgentResultsPopup.vue](awesomeposter/src/components/AgentResultsPopup.vue)
  - Show knob recommendations, expected lift, and evidence charts (bins and format-type deltas).
  - CSV upload flow already supported via assets upload; surface csvAssetId pointer in UI when debugging.

M11 — Background refresh (0.5 day)
- Add a lightweight job to recompute cache daily (respecting TTL). Can be cron or queue-based later.

Acceptance criteria
- Given a LinkedIn CSV for last 90 days, calling strategy_get_platform_insights returns:
  - cohortDescriptor { objective, topicCluster, timeframeDays, sampleSize }
  - knobInsights { recommended knob vector; expectedLiftPct; confidence; evidence with per-knob bin curves and format-type deltas }
- Strategy:
  - Calls the tool; sets top-level knobs and writerBrief.knobs = recommended; sets writerBrief.constraints (first-line length and scan density); rationale cites evidence.
- Content:
  - Applies constraints (first-line cap; scan density nudge) without breaking post structure.
- QA:
  - Computes realized knobs; flags deviations with expected impact deltas.
- Cache:
  - Cache hits for repeated requests within TTL for the same (client, platform, kpi, timeframe, objective, topicCluster).

Testing plan

1) Unit tests
- knob-inference: synthetic lines with known features produce expected knob values within tolerance.
- knob-lifts: controlled data yields correct impressions-weighted lifts and CI markers.
- cohort clustering: synthetic topic sets are correctly clustered and small clusters merged.

2) Integration tests (agents-server)
- Tool strategy_get_platform_insights end-to-end:
  - With well-formed CSV returns structured PlatformInsights.
  - Sparse cohort triggers fallback with low confidence.
  - Boosted rows are excluded from KPI estimation but appear in evidence counts.

3) Orchestrator pipeline
- Strategy step adopts knobInsights.recommended; Content and QA flow executes without regressions (smoke).

4) UI smoke
- Evidence renders in AgentResultsPopup; constraints visually applied in generated post.

Observability and safeguards
- Tool events and metrics already emitted by runtime; log cohortDescriptor, sample sizes, cache hits/misses, and confidence.
- Rate limiting and batch sizing for embeddings; retry-with-backoff on transient failures.
- Strict zod validation for tool params; helpful errors for column mapping.

Security and privacy
- CSV ingestion under client authorization; no scraping.
- Embeddings contain only short text snippets; API key secrets stored server-side.
- GDPR: avoid storing PII; cache stores aggregated analytics only.

Feature flags and env
- OPENAI_API_KEY (required server-side; Agents SDK already in use).
- Optionally INSIGHTS_TTL_HOURS (default 24).

Risks & mitigations
- Sparse cohorts (small accounts): widen ranges; mark low confidence; fall back to heuristics.
- Heuristic bias in knob inference: centralize calibration; plan A/B validation over time.
- Embedding cost: batch and cache; short text window (300 chars) to minimize tokens; use text-embedding-3-small.

Rollout timeline (estimate)
- Week 1: M0–M4 (contracts, migration, embeddings, CSV adapter, cohort)
- Week 2: M5–M7 (knob inference, lifts, recommendation, tool + Strategy/Orchestrator wiring)
- Week 3: M8–M10 (Content/QA enforcement, helper API, UI evidence), M11 (background refresh)

Work breakdown (files to add)
- Shared
  - [awesomeposter/packages/shared/src/insights.ts](awesomeposter/packages/shared/src/insights.ts)
- Agents-server (services)
  - [awesomeposter/packages/agents-server/src/services/insights/service.ts](awesomeposter/packages/agents-server/src/services/insights/service.ts)
  - [awesomeposter/packages/agents-server/src/services/insights/cache.ts](awesomeposter/packages/agents-server/src/services/insights/cache.ts)
  - [awesomeposter/packages/agents-server/src/services/insights/adapters/csv.ts](awesomeposter/packages/agents-server/src/services/insights/adapters/csv.ts)
  - [awesomeposter/packages/agents-server/src/services/insights/engine/cohort.ts](awesomeposter/packages/agents-server/src/services/insights/engine/cohort.ts)
  - [awesomeposter/packages/agents-server/src/services/insights/engine/knob-inference.ts](awesomeposter/packages/agents-server/src/services/insights/engine/knob-inference.ts)
  - [awesomeposter/packages/agents-server/src/services/insights/engine/knob-lifts.ts](awesomeposter/packages/agents-server/src/services/insights/engine/knob-lifts.ts)
  - [awesomeposter/packages/agents-server/src/services/insights/engine/recommendation.ts](awesomeposter/packages/agents-server/src/services/insights/engine/recommendation.ts)
- Agents-server (tools and agents)
  - Update [TypeScript.registerStrategyTools()](awesomeposter/packages/agents-server/src/tools/strategy.ts:132) to register strategy_get_platform_insights
  - Update [TypeScript.createStrategyAgent()](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts:77) allowlist & instructions [TypeScript.STRATEGY_INSTRUCTIONS_APP](awesomeposter/packages/agents-server/src/agents/strategy-manager.ts:15)
- Orchestrator
  - Update payload in [TypeScript.buildPayloadForCapability()](awesomeposter/packages/agents-server/src/services/orchestrator-engine.ts:317)
- DB
  - Migration: [awesomeposter/packages/db/drizzle/0008_platform_insights_cache.sql](awesomeposter/packages/db/drizzle/0008_platform_insights_cache.sql)
  - Schema: [awesomeposter/packages/db/src/schema.ts](awesomeposter/packages/db/src/schema.ts)
- API and UI (optional MVP+)
  - [awesomeposter/packages/agents-server/routes/api/v1/insights/ingest-csv.post.ts](awesomeposter/packages/agents-server/routes/api/v1/insights/ingest-csv.post.ts)
  - [awesomeposter/src/components/AgentResultsPopup.vue](awesomeposter/src/components/AgentResultsPopup.vue)

Acceptance checklist (product)
- Strategy returns knobs aligned with insights and evidence-backed rationale.
- Content’s first-line length and scan density are within recommended ranges.
- QA flags deviations and expected impact deltas.
- Cache hit behavior verified; TTL respected; fallbacks work as designed.

Done definition (engineering)
- CI passes unit + integration tests.
- Docs: this plan and [awesomeposter/docs/analytics-mvp-arch.md](awesomeposter/docs/analytics-mvp-arch.md) up to date.
- Feature guarded by config (can disable embeddings-based topics if needed).
