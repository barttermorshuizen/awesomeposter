# Agentic AI Social Poster — Technical Design (Vue SPA + Nitro + Mailgun)

## 1. Scope & Goals

- Build a multi-tenant web app that ingests client emails to create **draft briefs**, supports **manual brief creation**, runs an **agentic loop** with **4-knob optimization** (retrieve → generate → test → learn), and provides **inbox tasks**, **dashboards**, and **bandit learning** for continuous improvement.
- Priorities: **cheap to run**, **provider-agnostic email intake**, **clear service boundaries**, **ship fast**, **data-driven optimization**.

## 2. Key Decisions (Locked)

- **Framework:** Vue 3 SPA + Vite + Nitro — Vue composition API, client-side rendering with Nitro API backend.
- **Email intake:** Mailgun Inbound → HTTPS webhook (provider-agnostic normalization layer).
- **DB:** Postgres (Neon/ Supabase), later enable **pgvector** for retrieval.
- **Storage:** S3-compatible (Cloudflare R2) for raw MIME + attachments; CDN via Cloudflare.
- **Jobs/Schedule:** Vercel Cron + lightweight queue (Upstash Q) *or* Cloud Run Jobs; n8n optional for ETL.
- **LLM:** GPT‑5 for generation; text-embedding‑3‑large for retrieval.
- **Auth:** Clerk (Google SSO) *or* Supabase Auth (TBD) — pluggable.
- **Hosting:** Vercel (SPA + Nitro functions) + R2 + Neon (baseline under \~€50–€80/mo).
- **Optimization:** 4-knob system with bandit learning for continuous improvement.

## 3. High-Level Architecture

- **Vue 3 SPA** (UI only):
  - UI: Dashboard, Briefs, Inbox, Clients, Assets, Settings, Analytics.
  - Built with Vite for fast development and optimized production builds.
- **Nitro API Server** (API routes only):
  - API routes: brief CRUD, tasks, client profiles, webhook endpoints, publish actions, knob optimization.
  - Standalone API server that can be deployed independently from the UI.
- **Inbound Webhook** (`/api/inbound/mailgun`): verifies HMAC, stores raw MIME → R2, enqueues parse job.
- **Worker** (Nitro serverless function): parses email, extracts fields, creates/merges Brief Draft, links assets, creates Inbox task, sends notify.
- **Retrieval/Generation Service**: vector search (pgvector) → propose 4-knob settings → generate variants → score → create selection task.
- **Knob Optimization Engine**: bandit learning algorithms, A/B testing, performance correlation analysis.
- **ETL** (optional via n8n): import LinkedIn CSVs/metrics nightly; later replace with API.

> Service boundaries kept simple: SPA UI + Nitro API + background jobs + optimization engine. Clear separation between frontend and backend enables independent deployment and scaling.

### 3.1 Architecture Benefits & Tradeoffs

**Vue SPA + Nitro Benefits:**
- **Independent Scaling**: UI and API can be deployed and scaled separately
- **Development Velocity**: Vite provides fast HMR and build times
- **Cost Efficiency**: Static SPA hosting is cheaper than SSR
- **API Flexibility**: Nitro functions can be deployed to multiple platforms
- **Clear Boundaries**: Explicit separation between client and server concerns

**Tradeoffs vs. Nuxt SSR:**
- **SEO**: Client-side rendering means no initial HTML content for crawlers
- **Initial Load**: Larger JavaScript bundle must be downloaded before app becomes interactive
- **Complexity**: Requires managing CORS, authentication tokens, and API state separately
- **Caching**: Cannot leverage server-side caching strategies for dynamic content

**Mitigation Strategies:**
- Use meta tags and structured data for basic SEO
- Implement proper loading states and skeleton screens
- Leverage Vite's code splitting for smaller initial bundles
- Use service workers for offline functionality and caching

### 3.2 Current Implementation Status

**Fully Implemented:**
- Vue 3 SPA with Vite build system
- Nitro API server with comprehensive route structure
- Complete 4-knob agentic workflow (asset analysis → strategy → generation → evaluation → finalization)
- Language-aware AI agents with multi-language support
- Database schema with 4-knob telemetry and optimization tables
- Email webhook with HMAC verification
- Asset-constrained format type selection and validation

**Partially Implemented:**
- Email intake pipeline (webhook exists, but R2 storage and parse job not wired)
- Retrieval and ranking endpoints (routes exist but optimization logic incomplete)
- Basic API routes for briefs, tasks, clients, and assets

**Not Yet Implemented:**
- Authentication and client session scoping
- Knob optimization and analytics endpoints (/api/knobs/*, /api/analytics/*)
- Bandit learning algorithms and scheduled optimization jobs
- Telemetry logging endpoints
- R2 storage integration for email attachments
- Background job queue and worker execution
- Observability (Sentry, structured logging, tracing)
- Comprehensive test coverage

**Architecture Alignment:**
The current implementation successfully demonstrates the Vue SPA + Nitro API separation with a working agentic workflow that includes sophisticated asset analysis and language-aware content generation.

## 4.1 Language-Aware AI Agents

The system now includes primary communication language support across all AI agents:

- **Digital Marketeer Agent**: Considers language when planning strategy, hashtags, and cultural context
- **Copywriter Agent**: Generates all content in the client's preferred language (Nederlands, UK English, US English, Français)
- **Language Validation**: Ensures content appropriateness for the target language and cultural context
- **Fallback Handling**: Defaults to US English when language is not specified

## 4. Data Model (MVP + 4-Knob System)

```sql
-- multi-tenancy via client_id on most tables
CREATE TABLE clients (
  id uuid PRIMARY KEY, name text NOT NULL, slug text UNIQUE, settings_json jsonb DEFAULT '{}',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE client_profiles (
  id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  primary_communication_language text CHECK (primary_communication_language IN ('Nederlands', 'UK English', 'US English', 'Francais')),
  objectives_json jsonb NOT NULL, audiences_json jsonb NOT NULL,
  tone_json jsonb DEFAULT '{}', special_instructions_json jsonb DEFAULT '{}',
  guardrails_json jsonb DEFAULT '{}', platform_prefs_json jsonb DEFAULT '{}', permissions_json jsonb DEFAULT '{}',
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE briefs (
  id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  title text, description text, status text CHECK (status IN ('draft','approved','sent','published')) DEFAULT 'draft',
  objective text, audience_id text, deadline_at timestamptz,
  created_by uuid, updated_by uuid, created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE brief_versions (
  brief_id uuid REFERENCES briefs(id) ON DELETE CASCADE, version int, diff_json jsonb, created_at timestamptz DEFAULT now(), created_by uuid,
  PRIMARY KEY (brief_id, version)
);

CREATE TABLE assets (
  id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES briefs(id) ON DELETE CASCADE,
  filename text NOT NULL, original_name text, url text NOT NULL,
  type text CHECK (type IN ('image','document','video','audio','other')),
  mime_type text, file_size int, meta_json jsonb DEFAULT '{}',
  created_by uuid, created_at timestamptz DEFAULT now()
);

CREATE TABLE emails_ingested (
  id uuid PRIMARY KEY, client_id uuid, provider text, provider_event_id text, message_id text,
  from_email text, to_email text, subject text, raw_url text, parsed_json jsonb, status text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE posts (
  id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  platform text, brief_id uuid REFERENCES briefs(id) ON DELETE SET NULL,
  variant_id text, content_json jsonb, knobs_json jsonb, knob_payload_json jsonb,
  status text, created_at timestamptz DEFAULT now()
);

CREATE TABLE post_metrics (
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE, captured_at timestamptz,
  impressions int, reactions int, comments int, shares int, clicks int, ctr numeric,
  see_more_expands int, dwell_seconds_est numeric, is_boosted boolean DEFAULT false,
  PRIMARY KEY (post_id, captured_at)
);

-- New table for knob experiments and telemetry
CREATE TABLE knob_experiments (
  id uuid PRIMARY KEY, client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  brief_id uuid REFERENCES briefs(id) ON DELETE CASCADE,
  format_type text CHECK (format_type IN ('text','single_image','multi_image','document_pdf','video')),
  hook_intensity numeric CHECK (hook_intensity >= 0.0 AND hook_intensity <= 1.0),
  expertise_depth numeric CHECK (expertise_depth >= 0.0 AND expertise_depth <= 1.0),
  length_level numeric CHECK (length_level >= 0.0 AND length_level <= 1.0),
  scan_density numeric CHECK (scan_density >= 0.0 AND scan_density <= 1.0),
  assets_count int, created_at timestamptz DEFAULT now()
);

-- New table for post telemetry and performance data
CREATE TABLE post_telemetry (
  id uuid PRIMARY KEY, post_id uuid REFERENCES posts(id) ON DELETE CASCADE,
  client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
  knobs_json jsonb, observables_json jsonb, derived_metrics_json jsonb, render_metrics_json jsonb,
  captured_at timestamptz DEFAULT now()
);

-- Note: drizzle-orm/pg-vector types may require separate package; store as text for MVP if vector not available
CREATE TABLE examples_index (
  id uuid PRIMARY KEY, client_id uuid, platform text, embedding vector(1536),
  meta_json jsonb, perf_json jsonb, created_at timestamptz DEFAULT now()
);

CREATE TABLE experiments (
  id uuid PRIMARY KEY, brief_id uuid REFERENCES briefs(id) ON DELETE CASCADE,
  policy text, arm_json jsonb, result_json jsonb, created_at timestamptz DEFAULT now()
);

CREATE TABLE tasks (
  id uuid PRIMARY KEY, client_id uuid, type text, assignee_id uuid, status text,
  due_at timestamptz, payload_json jsonb, created_at timestamptz DEFAULT now()
);
```

### 4.1 Schema Updates (Latest)

**Migration 0002_4_knob_system.sql** includes:

**Posts Table Enhancements:**
- Added `knob_payload_json` for storing complete knob settings and client policy
- Enables full knob context for each post variant

**Post Metrics Table Improvements:**
- Added `see_more_expands` for tracking LinkedIn "see more" clicks
- Added `dwell_seconds_est` for estimated reading time
- Changed `ctr` to numeric type for better precision

**New Knob Experiments Table:**
- Tracks knob settings used for each post
- Enables correlation analysis between knobs and performance
- Supports bandit learning algorithms

**New Post Telemetry Table:**
- Comprehensive performance tracking
- Stores knob settings, raw metrics, derived metrics, and render analysis
- Foundation for continuous optimization

These changes enable:
- Complete knob tracking and optimization
- Performance correlation analysis
- Bandit learning for continuous improvement
- Rich telemetry for content optimization

## 5. API Contracts (selected)

### 5.1 Inbound Email Webhook (Mailgun)

**POST** `/api/inbound/mailgun`

- Verify signature (HMAC).
- Body: Mailgun payload. Normalize → `NormalizedInbound`.
- Response: `{ ok: true }` (always 200 after basic checks).

### 5.2 Briefs

- **POST** `/api/briefs` → create manual brief draft.
- **GET** `/api/briefs?clientId=&status=&q=&page=` → list with filters.
- **GET** `/api/briefs/:id` → detail (latest version + side panels data).
- **PATCH** `/api/briefs/:id` → update fields (creates `brief_versions` entry).
- **POST** `/api/briefs/:id/approve` → readiness check → status=`approved`.
- **POST** `/api/briefs/:id/send-to-agent` → kickoff Step 2 flow with 4-knob optimization.

### 5.3 Tasks

- **GET** `/api/tasks?type=&clientId=` → inbox.
- **POST** `/api/tasks/:id/complete` | `/snooze` | `/assign`.

### 5.4 Retrieval & Generation (4-Knob System)

- **POST** `/api/retrieve-winners` `{ briefId, filters }` → top-N examples.
- **POST** `/api/generate-variants` `{ briefId, refs[], knobPayload }` → variants based on knob settings.
- **POST** `/api/rank-variants` `{ briefId, variants[] }` → scores with knob effectiveness.
- **POST** `/api/select-variants` `{ postIds[] }` → schedule/publish.

### 5.5 Knob Optimization & Analytics

- **POST** `/api/knobs/optimize` `{ clientId, objective, constraints }` → suggested knob settings.
- **GET** `/api/knobs/performance?clientId=&formatType=&dateRange=` → knob effectiveness analysis.
- **POST** `/api/telemetry/log` `{ postId, knobs, observables, renderMetrics }` → log post performance.
- **GET** `/api/analytics/knob-trends?clientId=&metric=` → knob performance trends over time.

## 6. Email Intake Flow (Mailgun)

1. **Route** `socialposter@in.moreawesome.co` → Webhook.
2. **Webhook** stores raw MIME to R2, normalizes payload, inserts `emails_ingested`, enqueues parse job.
3. **Parser job**: parse body/attachments; client match; extract key messages/objective/audience; create or merge **Draft Brief**; link assets; create **Refine Brief** task; send notify email with brief link.
4. **Idempotency** by `Message-Id` + provider `eventId`.
5. **Security**: HMAC verify, IP allowlist optional, spam score routing.

## 7. Retrieval & Variant Generation (4-Knob System)

- **Asset Analysis:** Analyze available assets (images, documents, videos) for format feasibility
- **Format Validation:** Ensure chosen format type can be properly executed with available assets
- **Embeddings:** Store example posts as embeddings (title, copy, tags) in `examples_index`.
- **Retrieval filters:** client, platform, last 6–12 months, boosted=false by default.
- **Knob optimization:** AI-driven knob setting based on objective, **available assets**, and historical performance.
- **Format type selection:** Choose optimal container based on **available assets and their capabilities** and campaign goals.
- **Prompting:** include brief, selected references, knob payload, **asset analysis**, and client policy; output JSON with copy + metadata.
- **Ranking:** logistic regression with knob effectiveness scoring; score and sort variants.
- **Experiment:** record chosen knob combinations and outcomes for learning.

## 8. Knob Optimization Engine

### 8.1 Knob Setting Strategy

**Asset Analysis & Format Type Selection:**
- Analyze available assets (images, documents, videos) for each brief
- Assess asset quality, quantity, and suitability for different format types
- **CRITICAL CONSTRAINT: Format type selection is based EXCLUSIVELY on available assets**
- **Format Type Selection Logic (Asset-Only):**
  - `document_pdf` if slides available and objective supports deep content
  - `multi_image` if 3+ images available and objective is step-by-step
  - `single_image` if 1-2 images and objective is single insight
  - `text` as fallback for pure content posts
  - `video` if video assets and objective supports dynamic content
- **Asset Validation:** Ensure chosen format type can be properly executed with available assets
- **Fallback Strategy:** Provide alternative format recommendations if assets are insufficient
- **Brief Request Override:** Ignore brief format requests when assets are insufficient

**Hook Intensity Optimization:**
- Start with 0.65 baseline for balanced approach
- Adjust based on client voice policy (formal clients capped at 0.8)
- Increase for awareness/controversy objectives
- Decrease for educational/informational objectives

**Expertise Depth Calibration:**
- 0.7 baseline for most business content
- Increase for practitioner audiences and technical topics
- Decrease for general audiences and introductory content

**Structure Optimization:**
- `length_level`: 0.6 baseline (900-1200 chars)
- `scan_density`: 0.85 baseline for LinkedIn optimization
- Adjust based on platform and audience preferences

### 8.2 Bandit Learning Implementation

**Thompson Sampling for Format Types:**
- Categorical arms: text, single_image, multi_image, document_pdf, video
- Context: continuous knob values
- Reward: weighted engagement rate

**Contextual Bandits for Continuous Knobs:**
- Hook intensity, expertise depth, structure knobs
- Linear contextual bandit with ridge regression
- Regular updates based on new performance data

**Exploration vs. Exploitation:**
- ε-greedy with ε = 0.1 for initial exploration
- Thompson sampling for mature clients (>10 posts)
- A/B testing for major knob changes

## 9. Scheduling & Metrics

- **Publishing**: initial MVP = manual scheduling or CSV export; later add platform APIs.
- **Metrics ingest**: start with CSV imports via n8n; map to `post_metrics` and `post_telemetry`.
- **Knob tracking**: log all knob settings and performance outcomes.
- **Cron**: nightly update of metrics; weekly model refit; monthly knob optimization.

## 10. Security & Compliance

- Row-level access: every request scoped to `client_id` from auth session.
- Webhook HMAC validation + idempotency keys.
- Signed URLs for R2 assets; expire after 10–60 minutes.
- PII minimization: only emails/ids needed for matching; redact in logs.
- Audit trail: `brief_versions`, task history, and knob experiment tracking.
- Content validation: check for banned claims, verify numerical assertions.

## 11. Observability

- **Errors**: Sentry.
- **Logs**: Vercel/Logflare.
- **Tracing**: OpenTelemetry (Nitro plugin) optional for API routes.
- **Metrics**: basic counters (emails received, briefs drafted, variants generated).
- **Knob tracking**: comprehensive logging of knob settings and performance outcomes.
- **Performance correlation**: analysis of knob effectiveness over time.

## 12. Environment & Config

```
DATABASE_URL=
AUTH_SECRET=
MAILGUN_SIGNING_KEY=
R2_ENDPOINT=
R2_ACCESS_KEY=
R2_SECRET_KEY=
R2_BUCKET_RAW=
R2_BUCKET_ASSETS=
OPENAI_API_KEY=
APP_BASE_URL=
QUEUE_URL= (Upstash)
BANDIT_LEARNING_ENABLED=true
KNOB_OPTIMIZATION_INTERVAL=168 (hours)
```

## 13. Deployment

- **Vercel** for Vue SPA (static) + Nitro API functions; set environment vars per environment.
- **Cloudflare R2** bucket(s) + public CDN domain for assets.
- **Neon** Postgres + pgvector extension when retrieval is enabled.
- **n8n** (optional) on Cloud Run/Render for ETL.
- **Background jobs** for knob optimization and bandit learning updates.

## 14. Repo Structure (suggested)

```
awesomeposter/       # Main application directory
  src/               # Vue 3 SPA source
    components/      # Vue components
    views/           # Vue views/pages
    stores/          # Pinia stores
    router/          # Vue Router
    plugins/         # Vue plugins (Vuetify, etc.)
  server/            # Nitro API server
    api/             # API routes (Nitro)
    jobs/            # background jobs
    utils/           # email verify, normalize, storage, queue, agents
    shims/           # compatibility shims
  public/            # Static assets
  packages/
    db/              # Drizzle schema & migrations
    shared/          # shared types, constants (knob recipes)
```

## 15. Testing Strategy

- **Unit**: parsers, normalizers, scoring functions, knob optimization, Vue components.
- **Integration**: webhook → R2 → parse job → brief created; API endpoint testing.
- **E2E**: Playwright flows (create brief, approve, send to agent, select variants) against SPA + API.
- **API Testing**: Dedicated API route testing with mock data and authentication.
- **Component Testing**: Vue component testing with Vue Test Utils and Vitest.
- **Fixtures**: sample `.eml` files; CSV metrics files; knob test cases; API response mocks.
- **Knob testing**: A/B tests for knob combinations; performance validation.

## 16. Cost Model (MVP + Optimization)

- Vercel: free–\$20 (SPA hosting + Nitro functions)
- Neon: free–\$19
- R2: \~\$5
- Mailgun Inbound: \$0–\$15
- Clerk/Supabase Auth: \$0–\$25
- Upstash: \$0–\$10
- **Optimization compute**: \$5–\$15 (background jobs, bandit learning)
**Total:** ≈ €45–€95/mo with optimization features.

**SPA Benefits:** Static hosting is cheaper and more scalable than SSR, with API functions scaling independently.

## 17. Roadmap → Next

- Replace CSV metrics with LinkedIn API when approved.
- Implement bandit policy (Thompson Sampling) across knob combinations.
- Fine-tune small reward model for variant ranking with pairwise wins.
- Multi-platform publishing APIs.
- SLA & admin analytics dashboard.
- Advanced knob optimization with multi-objective learning.

## 18. 4-Knob System Implementation Details

### 18.1 Knob Validation & Constraints

**Character Budget Enforcement:**
- Hard cap at 2900 characters (leaving room for hashtags)
- Dynamic calculation based on length_level knob
- Validation in Copywriter agent before output

**Asset Requirements:**
- Format type must match available assets
- Multi-image requires ≥3 images
- Document PDF requires PDF URL or slides markdown
- Video requires video URL and caption

**Client Policy Enforcement:**
- Hook intensity capped by client voice policy
- Emoji usage controlled by client preferences
- Banned claims filtered during generation

### 18.2 Telemetry & Learning Pipeline

**Data Collection:**
- Log knob settings for each post
- Track performance metrics (impressions, engagement, see more expands)
- Analyze content characteristics (lines, sections, frameworks)

**Learning Loop:**
- Weekly analysis of knob effectiveness
- Monthly bandit model updates
- Quarterly knob strategy optimization

**Performance Metrics:**
- Engagement rate (reactions + comments + shares) / impressions
- See more expand rate for content depth analysis
- Dwell time estimation for content quality assessment

### 18.3 Integration Points

**Agent Workflow:**
- Digital Marketeer sets knobs based on strategy
- Copywriter renders content according to knob settings
- Orchestrator validates knob compliance
- Telemetry logged for learning

**UI Components:**
- Knob sliders and format type selectors
- Performance dashboards with knob correlation
- A/B testing interface for knob combinations
- Optimization recommendations display