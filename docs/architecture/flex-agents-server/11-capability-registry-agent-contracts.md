# 11. Capability Registry & Agent Contracts
- Capability metadata now lives alongside each agent (for example `packages/flex-agents-server/src/agents/marketing/strategist-social-posting.ts`); the module exports the capability payload with facet-based `inputContract` / `outputContract` arrays alongside prompt assets.
- A Nitro startup plugin consumes these exports and POSTs them to `/api/v1/flex/capabilities/register`, exercising the same validation/logging path as external registrants, and re-registers on an interval (`FLEX_CAPABILITY_SELF_REGISTER_REFRESH_MS`, default 5 minutes) to keep heartbeat status active.
- `PlannerService` uses the registry to resolve capabilities by matching facet coverage alongside envelope-driven channel/format hints surfaced from TaskEnvelope inputs and planner policies.
- `ContextBuilder` translates high-level objectives (for example “two variants”) into per-agent instructions so strategists craft briefs and writers fill slots without code changes.
- Agents continue to rely on natural-language prompts but receive machine-readable facet contracts and validation hints alongside human context.
- The registry service (`packages/flex-agents-server/src/services/flex-capability-registry.ts`) caches active entries in memory with a configurable TTL (`FLEX_CAPABILITY_CACHE_TTL_MS`) and automatically marks records inactive once their heartbeat timeout elapses.
- Facet declarations are validated against the shared catalog at registration time; the registry compiles merged JSON Schemas, persists `input_facets` / `output_facets` coverage hints, and rejects unknown facets or direction mismatches before capabilities become available.
- Legacy `defaultContract` fallbacks have been removed—registrations must provide explicit facet-backed `outputContract` payloads and the registry persists the compiled JSON Schema as the single source of truth.
- The database layer persists metadata to the shared `flex_capabilities` table (Drizzle schema + migration), keyed by `capability_id` with timestamps for `registered_at`, `last_seen_at`, and rolling `status` (`active`/`inactive`).
- Each agent module schedules a self-registration with the capability registry during bootstrap so the flex server advertises its capabilities without relying on a separate startup plugin.
- Planner consumers should retrieve capabilities via the registry service (`listActive`, `getCapabilityById`) to honour cache/heartbeat semantics instead of querying the database directly.
- SSE telemetry for `plan_generated` events now echoes per-node contract modes and facet coverage so downstream consumers can observe the facet-derived contract model in real time.

## Marketing Catalog Rollout & Rollback

- The curated marketing capability library lives in `packages/shared/src/flex/marketing-catalog.ts`. It exposes the marketing-aligned entries (`strategist.SocialPosting`, `strategist.Positioning`, `copywriter.SocialpostDrafting`, `copywriter.Messaging`, `designer.VisualDesign`, `director.SocialPostingReview`, `director.PositioningReview`) and the sandbox metadata route now responds with this set by default. All of these capabilities now declare the shared `company_information` facet as part of their `inputContract` to enforce consistent brand guardrails.
- Facets tagged with `["marketing-agency", "sandbox"]` – including `company_information` – are served through the same route by filtering the shared `FacetCatalog`. UI surfaces only render those tagged facets, keeping the legacy definitions available for regression fixtures while automatically advertising the new facet to downstream consumers.
- Deployment checklist:
  1. Run `npm run test:unit -- packages/flex-agents-server/__tests__/flex-sandbox-metadata.spec.ts` to verify the metadata response (the payload should now list the `company_information` facet alongside the curated marketing set).
  2. Spot-check the flex sandbox UI to confirm capability cards reflect the marketing taxonomy and that templates still load.
- Rollback plan:
  - Revert the marketing catalog deployment (reinstate the legacy capability modules and registry wiring) if regression fixtures must become the active catalog again—there is no runtime flag for toggling between catalogs.

## Facet Catalog

Facet definitions are centralised in `packages/shared/src/flex/facets/catalog.ts`. The exported `FacetCatalog` supplies typed lookups (`get`, `list`, `resolveMany`) while enforcing directionality (`input`, `output`, `bidirectional`) and uniqueness. Extend this module whenever new facets are introduced—planner helpers automatically start serving the new schema fragments without additional wiring.

| Facet | Direction | Description | Schema Sketch |
| --- | --- | --- | --- |
| `objectiveBrief` | input | Structured summary of the client’s stated objective, constraints, and success criteria. | Object with `objective` (string), optional `successCriteria[]` (string). |
| `audienceProfile` | input | Audience attributes (personas, segments, geography) that influence strategy and tone. | Object with `persona` (string), `segments[]` (string), optional `regions[]`. |
| `toneOfVoice` | input | Desired emotional/style tone for downstream copy. | Enum string (`friendly`, `professional`, `inspiring`, etc.). |
| `assetBundle` | input | Links or embedded assets (docs, images) to ground planning. | Array of `{ type, payload }` objects with typed payload per asset. |
| `writerBrief` | input/output | Narrative direction, key points, blockers for writers; produced by strategy, consumed by execution. | Object with `angle`, `keyPoints[]`, `constraints[]`. |
| `planKnobs` | input/output | Normalised levers the orchestrator can tweak (variant counts, CTA emphasis, length). | Object with numeric/string knobs (`variantCount`, `ctaFocus`, `length`). |
| `strategicRationale` | output | Strategy justification and high-level narrative reasoning. | Object with `northStar`, `whyItWorks`, optional `risks`. |
| `copyVariants` | input/output | Structured set of draft variants for distribution downstream. | Array of `{ headline, body, callToAction }` objects. |
| `qaRubric` | input | Policy and quality rubric settings QA should enforce. | Object with `checks[]` (enum), `thresholds` (object). |
| `qaFindings` | output | QA results with scores and compliance flags. | Object with `scores`, `issues[]`, `overallStatus`. |
| `recommendationSet` | output | Normalised follow-up actions for editors or writers. | Array of `{ severity, recommendation, rationale }`. |
| `clarificationRequest` | input | Outstanding questions and rationale requiring human strategist input. | Object with `pendingQuestions[]` containing `{ id, question, priority, required, context }`. |
| `clarificationResponse` | output | Structured answers or declines supplied by human strategists. | Object with `responses[]` capturing `{ questionId, status, response, notes }` plus optional attachments. |

## Current Inventory

| Capability ID | Display Name | Responsibilities | Input Facets | Output Facets | Source |
| --- | --- | --- | --- | --- | --- |
| `strategist.SocialPosting` | Strategist – Social Posting | Plans social campaign briefs, rationale, and handoff notes from marketing-context inputs. | `post_context`, `feedback` | `creative_brief`, `strategic_rationale`, `handoff_summary` | `packages/flex-agents-server/src/agents/marketing/strategist-social-posting.ts` |
| `strategist.Positioning` | Strategist – Positioning | Transforms market inputs into an updated positioning canvas, opportunity list, and recommendation. | `positioning_context`, `feedback` | `value_canvas`, `positioning_opportunities`, `positioning_recommendation`, `handoff_summary` | `packages/flex-agents-server/src/agents/marketing/strategist-positioning.ts` |
| `copywriter.SocialpostDrafting` | Copywriter – Social Drafting | Generates or revises campaign copy using strategist output and reviewer feedback. | `creative_brief`, `handoff_summary`, `feedback` | `post_copy`, `handoff_summary` | `packages/flex-agents-server/src/agents/marketing/copywriter-socialpost-drafting.ts` |
| `copywriter.Messaging` | Copywriter – Messaging Stack | Converts positioning recommendations into a structured messaging hierarchy. | `positioning_context`, `positioning_recommendation`, `feedback` | `messaging_stack`, `handoff_summary` | `packages/flex-agents-server/src/agents/marketing/copywriter-messaging.ts` |
| `designer.VisualDesign` | Designer – Visual Design | Creates or sources campaign visuals aligned with strategist guidance and reviewer feedback. | `creative_brief`, `handoff_summary`, `feedback` | `post_visual`, `handoff_summary` | `packages/flex-agents-server/src/agents/marketing/designer-visual-design.ts` |
| `director.SocialPostingReview` | Director – Social Review | Reviews campaign deliverables, approves final social posts, or records structured feedback. | `post_context`, `strategic_rationale`, `post_copy`, `post_visual` | `post`, `feedback` | `packages/flex-agents-server/src/agents/marketing/director-social-review.ts` |
| `director.PositioningReview` | Director – Positioning Review | Approves positioning recommendations and messaging stacks or records actionable feedback. | `positioning_context`, `value_canvas`, `positioning_opportunities`, `positioning_recommendation`, `messaging_stack` | `positioning`, `feedback` | `packages/flex-agents-server/src/agents/marketing/director-positioning-review.ts` |
| `HumanAgent.clarifyBrief` | Human Operator – Brief Clarification | Resolves planner clarification requests with structured human responses; declines or missed SLAs fail the run. | `objectiveBrief`, `audienceProfile`, `toneOfVoice`, `writerBrief`, `clarificationRequest` | `clarificationResponse` | `packages/flex-agents-server/src/agents/human-clarify-brief.ts` |

> Capability metadata, facet coverage, costs, and heartbeat settings are the source of truth—update the tables above and the corresponding agent module together during future agent work. Add new facets to the catalog before referencing them in capabilities.

### Contract Compiler & Validation Helpers

- `packages/shared/src/flex/facets/contract-compiler.ts` exposes `FacetContractCompiler`, which composes deterministic `inputSchema` / `outputSchema` payloads, tracks provenance, and hands back Ajv validators for the execution engine.
- Planner-facing helpers live in `packages/flex-agents-server/src/utils/facet-contracts.ts`; use `buildFacetAwareNodeContracts` to attach compiled facet contracts to plan nodes and derive human-readable instructions.
- Fixtures under `packages/flex-agents-server/src/utils/__fixtures__/facet-node.fixture.ts` illustrate how nodes carry compiled schemas for testing and planner prototyping.
- Validation helpers (`validateFacetInputs`/`validateFacetOutputs`) surface `FacetValidationError` objects that include the originating facet, JSON pointer, and Ajv keyword—ExecutionEngine and OutputValidator can adopt them without additional plumbing.

## Supporting Utilities

- Marketing specialists rely on the shared HITL adapters (`packages/flex-agents-server/src/tools/hitl.ts`) for escalation; legacy strategy/content/qa tool bundles have been retired with the capability catalog rip-and-replace.

## Developer Sandbox

- Enable the flex planner sandbox by setting `USE_FLEX_DEV_SANDBOX=true` on the agents server and `VITE_USE_FLEX_DEV_SANDBOX=true` in the SPA build (both names are accepted by the server so scripts can export a single value). With the flag disabled the `/flex/sandbox` route, metadata API, and navigation entry stay hidden from production users.
- The curated marketing experience is driven by registry metadata: each Story 11.1 capability now registers with `metadata.catalogTags = ["marketing-agency", "sandbox"]` and the corresponding facets advertise `catalogTags` in the shared catalog. The sandbox metadata response already includes these fields, so the Vue client filters to the seven marketing capabilities (and their tagged facets) without changing transport contracts.
- The SPA fetches registry data from `GET /api/v1/flex/sandbox/metadata`, which returns facet catalog entries, capability snapshots (`active` + `all`), capability catalog prompts, and any `tmp/flex-*.json` TaskEnvelope templates. Override the template source via `FLEX_SANDBOX_TEMPLATE_DIR` when running custom experiments.
- The guided conversational builder is gated by the same sandbox flag. The UI calls `POST /api/v1/flex/sandbox/envelope/conversation/start` followed by `POST /api/v1/flex/sandbox/envelope/conversation/{id}/respond`, both of which run only when `USE_FLEX_DEV_SANDBOX` is truthy and never persist envelope drafts server-side.
- Assistant responses contain compact JSON Patch operations (`[{ op, path, value }]`) that the server applies to the current envelope before re-validating with `TaskEnvelopeSchema`. Empty patches leave the draft untouched while still surfacing missing-field guidance.
- Conversation turns use GPT-5 by default. To target a different model set `FLEX_OPENAI_DEFAULT_MODEL` (the agents service also honours `OPENAI_DEFAULT_MODEL` / `OPENAI_MODEL` overrides). If the service returns a 429 the SPA surfaces a retry banner; otherwise the response payload embeds validation/missing-field messaging and is echoed back to the Vue JSON tree.
- Troubleshooting: ensure `FLEX_OPENAI_API_KEY` (or `OPENAI_API_KEY`) is present, verify the sandbox feature flag is enabled in both the server and SPA, and confirm legacy templates still load (`/tmp/flex-*.json`) so operators can fall back to manual editing when LLM guidance is unavailable.
- Sandbox runs use the existing `/api/v1/flex/run.stream` endpoint, so the feature inherits auth and SSE limits. The view streams `FlexEvent` frames with the shared `postFlexEventStream` helper to keep line with operator tooling.
- The Vue workspace persists draft envelopes in `localStorage`, performs schema and capability validation client-side with `TaskEnvelopeSchema`, and surfaces planner telemetry through `FlexSandboxPlanInspector.vue`. Derived capability provenance, policy triggers, and node statuses reflect the enriched `plan_generated` / `plan_updated` events emitted by `FlexRunCoordinator`.
- Treat the sandbox as non-production tooling: it never mutates registry state, respects existing API keys, and should only run in secure dev/staging environments. Disable the flag before shipping a prod build to guarantee the UI and routes are omitted.

## Maintenance Checklist

1. Update the capability payload inside the relevant agent module when prompts, facet coverage, or preferred models change.
2. Mirror those edits in the facet catalog and capability inventory tables so downstream teams know where source lives and what constraints apply.
3. Run `npm run test:unit -- packages/shared/__tests__/flex/facet-contract-compiler.spec.ts packages/flex-agents-server/__tests__/facets/facet-contracts.spec.ts packages/flex-agents-server/__tests__/capability-registry-facets.spec.ts packages/flex-agents-server/__tests__/docs/facet-inventory.spec.ts` (plus the capability registry suite) to confirm catalog integrity, registry validation, and documentation alignment before hand-off.
4. If heartbeat expectations change, adjust `FLEX_CAPABILITY_REFRESH_INTERVAL_MS` or the per-capability heartbeat fields so registry status stays accurate.
