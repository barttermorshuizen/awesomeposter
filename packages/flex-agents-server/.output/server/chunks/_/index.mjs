import { u as useRuntimeConfig } from '../nitro/nitro.mjs';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { pgTable, timestamp, uuid, text, jsonb, integer, primaryKey, boolean, numeric } from 'drizzle-orm/pg-core';
import { eq } from 'drizzle-orm';

const clients = pgTable("clients", {
  id: uuid("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").unique(),
  website: text("website"),
  industry: text("industry"),
  settingsJson: jsonb("settings_json").$type().default({}),
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
    clientProfiles: clientProfiles,
    clients: clients,
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
async function getClientProfileByClientId(clientId) {
  const db = getDb();
  const [row] = await db.select().from(clientProfiles).where(eq(clientProfiles.clientId, clientId)).limit(1);
  return row != null ? row : null;
}

export { assets as a, briefs as b, hitlResponses as c, clients as d, getClientProfileByClientId as e, getDb as g, hitlRequests as h, orchestratorRuns as o };
//# sourceMappingURL=index.mjs.map
