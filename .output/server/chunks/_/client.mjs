import { u as useRuntimeConfig } from '../nitro/nitro.mjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { pgTable, timestamp, uuid, text, jsonb, integer, boolean, primaryKey, numeric, uniqueIndex, unique, index } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const clients = pgTable("clients", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  website: text("website"),
  industry: text("industry"),
  settingsJson: jsonb("settings_json").$type().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const clientFeatures = pgTable("client_features", {
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  feature: text("feature").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
}, (table) => ({
  pk: primaryKey({ columns: [table.clientId, table.feature] })
}));
const clientFeatureToggleAudits = pgTable("client_feature_toggle_audits", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  feature: text("feature").notNull(),
  previousEnabled: boolean("previous_enabled").notNull(),
  newEnabled: boolean("new_enabled").notNull(),
  actor: text("actor").notNull(),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const clientProfiles = pgTable("client_profiles", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  primaryCommunicationLanguage: text("primary_communication_language").$type(),
  objectivesJson: jsonb("objectives_json").$type().notNull(),
  audiencesJson: jsonb("audiences_json").$type().notNull(),
  toneJson: jsonb("tone_json").$type().default({}),
  specialInstructionsJson: jsonb("special_instructions_json").$type().default({}),
  guardrailsJson: jsonb("guardrails_json").$type().default({}),
  platformPrefsJson: jsonb("platform_prefs_json").$type().default({}),
  permissionsJson: jsonb("permissions_json").$type().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
const briefs = pgTable("briefs", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  title: text("title"),
  description: text("description"),
  status: text("status").$type().default("draft"),
  objective: text("objective"),
  audienceId: text("audience_id"),
  deadlineAt: timestamp("deadline_at", { withTimezone: true }),
  createdBy: uuid("created_by"),
  updatedBy: uuid("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
const briefVersions = pgTable("brief_versions", {
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "cascade" }),
  version: integer("version"),
  diffJson: jsonb("diff_json").$type(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  createdBy: uuid("created_by")
}, (table) => ({
  pk: primaryKey({ columns: [table.briefId, table.version] })
}));
const assets = pgTable("assets", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "cascade" }),
  filename: text("filename"),
  originalName: text("original_name"),
  url: text("url").notNull(),
  type: text("type").$type(),
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  metaJson: jsonb("meta_json").$type().default({}),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const emailsIngested = pgTable("emails_ingested", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id"),
  provider: text("provider"),
  providerEventId: text("provider_event_id"),
  messageId: text("message_id"),
  fromEmail: text("from_email"),
  toEmail: text("to_email"),
  subject: text("subject"),
  rawUrl: text("raw_url"),
  parsedJson: jsonb("parsed_json").$type(),
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const posts = pgTable("posts", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  platform: text("platform"),
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "set null" }),
  variantId: text("variant_id"),
  contentJson: jsonb("content_json").$type(),
  knobsJson: jsonb("knobs_json").$type(),
  knobPayloadJson: jsonb("knob_payload_json").$type(),
  // New field for knob payload
  status: text("status"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const postMetrics = pgTable("post_metrics", {
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  capturedAt: timestamp("captured_at", { withTimezone: true }),
  impressions: integer("impressions"),
  reactions: integer("reactions"),
  comments: integer("comments"),
  shares: integer("shares"),
  clicks: integer("clicks"),
  ctr: numeric("ctr"),
  seeMoreExpands: integer("see_more_expands"),
  // New field for see more expands
  dwellSecondsEst: numeric("dwell_seconds_est"),
  // New field for estimated dwell time
  isBoosted: boolean("is_boosted").default(false)
}, (table) => ({
  pk: primaryKey({ columns: [table.postId, table.capturedAt] })
}));
const examplesIndex = pgTable("examples_index", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id"),
  platform: text("platform"),
  // Placeholder: store embedding as JSON until pgvector is enabled
  embedding: jsonb("embedding").$type(),
  metaJson: jsonb("meta_json").$type(),
  perfJson: jsonb("perf_json").$type(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const experiments = pgTable("experiments", {
  id: uuid("id").primaryKey(),
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "cascade" }),
  policy: text("policy"),
  armJson: jsonb("arm_json").$type(),
  resultJson: jsonb("result_json").$type(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const knobExperiments = pgTable("knob_experiments", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "cascade" }),
  formatType: text("format_type").$type(),
  hookIntensity: numeric("hook_intensity"),
  expertiseDepth: numeric("expertise_depth"),
  lengthLevel: numeric("length_level"),
  scanDensity: numeric("scan_density"),
  assetsCount: integer("assets_count"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const postTelemetry = pgTable("post_telemetry", {
  id: uuid("id").primaryKey(),
  postId: uuid("post_id").references(() => posts.id, { onDelete: "cascade" }),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }),
  knobsJson: jsonb("knobs_json").$type(),
  // Full knob payload
  observablesJson: jsonb("observables_json").$type(),
  // Raw metrics
  derivedMetricsJson: jsonb("derived_metrics_json").$type(),
  // Calculated metrics
  renderMetricsJson: jsonb("render_metrics_json").$type(),
  // Content analysis
  capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow()
});
const tasks = pgTable("tasks", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id"),
  type: text("type"),
  assigneeId: uuid("assignee_id"),
  status: text("status"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  payloadJson: jsonb("payload_json").$type(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});
const discoverySources = pgTable("discovery_sources", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  url: text("url").notNull(),
  canonicalUrl: text("canonical_url").notNull(),
  sourceType: text("source_type").$type().notNull(),
  identifier: text("identifier").notNull(),
  notes: text("notes"),
  configJson: jsonb("config_json").$type().default(null),
  fetchIntervalMinutes: integer("fetch_interval_minutes").notNull().default(60),
  nextFetchAt: timestamp("next_fetch_at", { withTimezone: true }).default(sql`now()`),
  lastFetchStartedAt: timestamp("last_fetch_started_at", { withTimezone: true }),
  lastFetchCompletedAt: timestamp("last_fetch_completed_at", { withTimezone: true }),
  lastFetchStatus: text("last_fetch_status").$type().default("idle"),
  lastFailureReason: text("last_failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
}, (table) => ({
  clientSourceIdentifierUnique: unique("discovery_sources_client_identifier_unique").on(table.clientId, table.sourceType, table.identifier),
  clientSourceIdentifierLowerUnique: uniqueIndex("discovery_sources_client_identifier_lower_unique").on(table.clientId, table.sourceType, sql`lower(${table.identifier})`)
}));
const discoveryKeywords = pgTable("discovery_keywords", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  keyword: text("keyword").notNull(),
  keywordAlias: text("keyword_alias").notNull(),
  addedBy: text("added_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
}, (table) => ({
  clientKeywordAliasUnique: unique("discovery_keywords_client_alias_unique").on(table.clientId, table.keywordAlias)
}));
const discoveryIngestRuns = pgTable("discovery_ingest_runs", {
  id: uuid("id").primaryKey(),
  runId: text("run_id").notNull(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").references(() => discoverySources.id, { onDelete: "cascade" }).notNull(),
  status: text("status").$type().notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  durationMs: integer("duration_ms"),
  failureReason: text("failure_reason"),
  retryInMinutes: integer("retry_in_minutes"),
  metricsJson: jsonb("metrics_json").$type().default({}),
  telemetryJson: jsonb("telemetry_json").$type().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
}, (table) => ({
  runIdUnique: unique("discovery_ingest_runs_run_id_unique").on(table.runId)
}));
const discoveryItems = pgTable("discovery_items", {
  id: uuid("id").primaryKey(),
  clientId: uuid("client_id").references(() => clients.id, { onDelete: "cascade" }).notNull(),
  sourceId: uuid("source_id").references(() => discoverySources.id, { onDelete: "cascade" }).notNull(),
  externalId: text("external_id").notNull(),
  rawHash: text("raw_hash").notNull(),
  status: text("status").$type().default("pending_scoring").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedAtSource: text("published_at_source").$type().notNull(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).defaultNow(),
  rawPayloadJson: jsonb("raw_payload_json").$type().notNull(),
  normalizedJson: jsonb("normalized_json").$type().notNull(),
  sourceMetadataJson: jsonb("source_metadata_json").$type().notNull()
}, (table) => ({
  clientHashUnique: uniqueIndex("discovery_items_client_hash_unique").on(table.clientId, table.rawHash),
  statusIdx: index("discovery_items_status_idx").on(table.status),
  sourceIdx: index("discovery_items_source_idx").on(table.sourceId)
}));
const orchestratorRuns = pgTable("orchestrator_runs", {
  runId: text("run_id").primaryKey(),
  threadId: text("thread_id"),
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "set null" }),
  status: text("status").$type().default("pending"),
  planSnapshotJson: jsonb("plan_snapshot_json").$type().default({ version: 0, steps: [] }),
  stepHistoryJson: jsonb("step_history_json").$type().default([]),
  runReportJson: jsonb("run_report_json").$type().default(null),
  hitlStateJson: jsonb("hitl_state_json").$type().default({ requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }),
  executionContextJson: jsonb("execution_context_json").$type().default({}),
  runnerMetadataJson: jsonb("runner_metadata_json").$type().default({}),
  pendingRequestId: text("pending_request_id"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
const hitlRequests = pgTable("hitl_requests", {
  id: text("id").primaryKey(),
  runId: text("run_id").references(() => orchestratorRuns.runId, { onDelete: "cascade" }),
  briefId: uuid("brief_id").references(() => briefs.id, { onDelete: "set null" }),
  threadId: text("thread_id"),
  stepId: text("step_id"),
  originAgent: text("origin_agent").$type(),
  status: text("status").$type().default("pending"),
  payloadJson: jsonb("payload_json").$type().notNull(),
  denialReason: text("denial_reason"),
  metricsJson: jsonb("metrics_json").$type().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow()
});
const hitlResponses = pgTable("hitl_responses", {
  id: text("id").primaryKey(),
  requestId: text("request_id").references(() => hitlRequests.id, { onDelete: "cascade" }),
  responseType: text("response_type").$type(),
  selectedOptionId: text("selected_option_id"),
  freeformText: text("freeform_text"),
  approved: boolean("approved"),
  responderId: text("responder_id"),
  responderDisplayName: text("responder_display_name"),
  metadataJson: jsonb("metadata_json").$type().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow()
});

const schema = /*#__PURE__*/Object.freeze({
    __proto__: null,
    assets: assets,
    briefVersions: briefVersions,
    briefs: briefs,
    clientFeatureToggleAudits: clientFeatureToggleAudits,
    clientFeatures: clientFeatures,
    clientProfiles: clientProfiles,
    clients: clients,
    discoveryIngestRuns: discoveryIngestRuns,
    discoveryItems: discoveryItems,
    discoveryKeywords: discoveryKeywords,
    discoverySources: discoverySources,
    emailsIngested: emailsIngested,
    examplesIndex: examplesIndex,
    experiments: experiments,
    hitlRequests: hitlRequests,
    hitlResponses: hitlResponses,
    knobExperiments: knobExperiments,
    orchestratorRuns: orchestratorRuns,
    postMetrics: postMetrics,
    postTelemetry: postTelemetry,
    posts: posts,
    tasks: tasks
});

let cachedPool = null;
let cachedDb = null;
function getPool() {
  if (cachedPool)
    return cachedPool;
  let databaseUrl;
  try {
    const runtimeConfig = useRuntimeConfig();
    databaseUrl = runtimeConfig.DATABASE_URL;
  } catch {
    databaseUrl = process.env.DATABASE_URL;
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not set in runtime config or process.env");
  }
  cachedPool = new pg.Pool({ connectionString: databaseUrl });
  return cachedPool;
}
function getDb() {
  if (cachedDb)
    return cachedDb;
  const pool = getPool();
  cachedDb = drizzle(pool, { schema });
  return cachedDb;
}

export { assets as a, briefs as b, clients as c, clientFeatures as d, clientFeatureToggleAudits as e, emailsIngested as f, getDb as g, examplesIndex as h, getPool as i, discoveryItems as j, discoveryKeywords as k, discoverySources as l, discoveryIngestRuns as m, clientProfiles as n, orchestratorRuns as o, hitlRequests as p, hitlResponses as q, tasks as t };
//# sourceMappingURL=client.mjs.map
