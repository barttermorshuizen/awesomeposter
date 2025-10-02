import { pgTable, text, uuid, timestamp, jsonb, integer, primaryKey, boolean, numeric, unique } from 'drizzle-orm/pg-core'

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  website: text('website'),
  industry: text('industry'),
  settingsJson: jsonb('settings_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const clientProfiles = pgTable('client_profiles', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  primaryCommunicationLanguage: text('primary_communication_language').$type<'Nederlands' | 'UK English' | 'US English' | 'Francais'>(),
  objectivesJson: jsonb('objectives_json').$type<Record<string, unknown>>().notNull(),
  audiencesJson: jsonb('audiences_json').$type<Record<string, unknown>>().notNull(),
  toneJson: jsonb('tone_json').$type<Record<string, unknown>>().default({}),
  specialInstructionsJson: jsonb('special_instructions_json').$type<Record<string, unknown>>().default({}),
  guardrailsJson: jsonb('guardrails_json').$type<Record<string, unknown>>().default({}),
  platformPrefsJson: jsonb('platform_prefs_json').$type<Record<string, unknown>>().default({}),
  permissionsJson: jsonb('permissions_json').$type<Record<string, unknown>>().default({}),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
})

export const briefs = pgTable('briefs', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  title: text('title'),
  description: text('description'),
  status: text('status').$type<'draft' | 'approved' | 'sent' | 'published'>().default('draft'),
  objective: text('objective'),
  audienceId: text('audience_id'),
  deadlineAt: timestamp('deadline_at', { withTimezone: true }),
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
})

export const briefVersions = pgTable('brief_versions', {
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'cascade' }),
  version: integer('version'),
  diffJson: jsonb('diff_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  createdBy: uuid('created_by')
}, (table) => ({
  pk: primaryKey({ columns: [table.briefId, table.version] })
}))

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'cascade' }),
  filename: text('filename'),
  originalName: text('original_name'),
  url: text('url').notNull(),
  type: text('type').$type<'image' | 'document' | 'video' | 'audio' | 'other'>(),
  mimeType: text('mime_type'),
  fileSize: integer('file_size'),
  metaJson: jsonb('meta_json').$type<Record<string, unknown>>().default({}),
  createdBy: uuid('created_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const emailsIngested = pgTable('emails_ingested', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id'),
  provider: text('provider'),
  providerEventId: text('provider_event_id'),
  messageId: text('message_id'),
  fromEmail: text('from_email'),
  toEmail: text('to_email'),
  subject: text('subject'),
  rawUrl: text('raw_url'),
  parsedJson: jsonb('parsed_json').$type<Record<string, unknown>>(),
  status: text('status'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const posts = pgTable('posts', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  platform: text('platform'),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
  variantId: text('variant_id'),
  contentJson: jsonb('content_json').$type<Record<string, unknown>>(),
  knobsJson: jsonb('knobs_json').$type<Record<string, unknown>>(),
  knobPayloadJson: jsonb('knob_payload_json').$type<Record<string, unknown>>(), // New field for knob payload
  status: text('status'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const postMetrics = pgTable('post_metrics', {
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  capturedAt: timestamp('captured_at', { withTimezone: true }),
  impressions: integer('impressions'),
  reactions: integer('reactions'),
  comments: integer('comments'),
  shares: integer('shares'),
  clicks: integer('clicks'),
  ctr: numeric('ctr'),
  seeMoreExpands: integer('see_more_expands'), // New field for see more expands
  dwellSecondsEst: numeric('dwell_seconds_est'), // New field for estimated dwell time
  isBoosted: boolean('is_boosted').default(false)
}, (table) => ({
  pk: primaryKey({ columns: [table.postId, table.capturedAt] })
}))

// Note: drizzle-orm/pg-vector types may require separate package; store as text for MVP if vector not available
export const examplesIndex = pgTable('examples_index', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id'),
  platform: text('platform'),
  // Placeholder: store embedding as JSON until pgvector is enabled
  embedding: jsonb('embedding').$type<number[] | null>(),
  metaJson: jsonb('meta_json').$type<Record<string, unknown>>(),
  perfJson: jsonb('perf_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const experiments = pgTable('experiments', {
  id: uuid('id').primaryKey(),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'cascade' }),
  policy: text('policy'),
  armJson: jsonb('arm_json').$type<Record<string, unknown>>(),
  resultJson: jsonb('result_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

// New table for knob experiments and telemetry
export const knobExperiments = pgTable('knob_experiments', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'cascade' }),
  formatType: text('format_type').$type<'text' | 'single_image' | 'multi_image' | 'document_pdf' | 'video'>(),
  hookIntensity: numeric('hook_intensity'),
  expertiseDepth: numeric('expertise_depth'),
  lengthLevel: numeric('length_level'),
  scanDensity: numeric('scan_density'),
  assetsCount: integer('assets_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

// New table for post telemetry and performance data
export const postTelemetry = pgTable('post_telemetry', {
  id: uuid('id').primaryKey(),
  postId: uuid('post_id').references(() => posts.id, { onDelete: 'cascade' }),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }),
  knobsJson: jsonb('knobs_json').$type<Record<string, unknown>>(), // Full knob payload
  observablesJson: jsonb('observables_json').$type<Record<string, unknown>>(), // Raw metrics
  derivedMetricsJson: jsonb('derived_metrics_json').$type<Record<string, unknown>>(), // Calculated metrics
  renderMetricsJson: jsonb('render_metrics_json').$type<Record<string, unknown>>(), // Content analysis
  capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow()
})

export const tasks = pgTable('tasks', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id'),
  type: text('type'),
  assigneeId: uuid('assignee_id'),
  status: text('status'),
  dueAt: timestamp('due_at', { withTimezone: true }),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const discoverySources = pgTable('discovery_sources', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  url: text('url').notNull(),
  canonicalUrl: text('canonical_url').notNull(),
  sourceType: text('source_type').$type<'rss' | 'youtube-channel' | 'youtube-playlist' | 'web-page'>().notNull(),
  identifier: text('identifier').notNull(),
  notes: text('notes'),
  configJson: jsonb('config_json').$type<Record<string, unknown> | null>().default(null),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (table) => ({
  clientSourceIdentifierUnique: unique('discovery_sources_client_identifier_unique').on(table.clientId, table.sourceType, table.identifier)
 }))


export const orchestratorRuns = pgTable('orchestrator_runs', {
  runId: text('run_id').primaryKey(),
  threadId: text('thread_id'),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
  status: text('status').$type<'pending' | 'running' | 'awaiting_hitl' | 'completed' | 'cancelled' | 'removed' | 'failed'>().default('pending'),
  planSnapshotJson: jsonb('plan_snapshot_json').$type<Record<string, unknown>>().default({ version: 0, steps: [] }),
  stepHistoryJson: jsonb('step_history_json').$type<Array<Record<string, unknown>>>().default([]),
  runReportJson: jsonb('run_report_json').$type<Record<string, unknown> | null>().default(null),
  hitlStateJson: jsonb('hitl_state_json').$type<Record<string, unknown>>().default({ requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }),
  executionContextJson: jsonb('execution_context_json').$type<Record<string, unknown>>().default({}),
  runnerMetadataJson: jsonb('runner_metadata_json').$type<Record<string, unknown>>().default({}),
  pendingRequestId: text('pending_request_id'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
})

export const hitlRequests = pgTable('hitl_requests', {
  id: text('id').primaryKey(),
  runId: text('run_id').references(() => orchestratorRuns.runId, { onDelete: 'cascade' }),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
  threadId: text('thread_id'),
  stepId: text('step_id'),
  originAgent: text('origin_agent').$type<'strategy' | 'generation' | 'qa'>(),
  status: text('status').$type<'pending' | 'resolved' | 'denied'>().default('pending'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  denialReason: text('denial_reason'),
  metricsJson: jsonb('metrics_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
})

export const hitlResponses = pgTable('hitl_responses', {
  id: text('id').primaryKey(),
  requestId: text('request_id').references(() => hitlRequests.id, { onDelete: 'cascade' }),
  responseType: text('response_type').$type<'option' | 'approval' | 'rejection' | 'freeform'>(),
  selectedOptionId: text('selected_option_id'),
  freeformText: text('freeform_text'),
  approved: boolean('approved'),
  responderId: text('responder_id'),
  responderDisplayName: text('responder_display_name'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})
