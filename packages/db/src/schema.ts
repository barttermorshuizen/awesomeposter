import { pgTable, text, uuid, timestamp, jsonb, integer, primaryKey, boolean, numeric, unique, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'
import { vector } from 'drizzle-orm/pg-core/columns/vector_extension/vector'

export const clients = pgTable('clients', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').unique(),
  website: text('website'),
  industry: text('industry'),
  settingsJson: jsonb('settings_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow()
})

export const clientFeatures = pgTable('client_features', {
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  feature: text('feature').notNull(),
  enabled: boolean('enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  pk: primaryKey({ columns: [table.clientId, table.feature] }),
}))

export const clientFeatureToggleAudits = pgTable('client_feature_toggle_audits', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  feature: text('feature').notNull(),
  previousEnabled: boolean('previous_enabled').notNull(),
  newEnabled: boolean('new_enabled').notNull(),
  actor: text('actor').notNull(),
  reason: text('reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
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

export const flexAssets = pgTable('flex_assets', {
  id: uuid('id').primaryKey(),
  assignmentId: text('assignment_id').notNull(),
  runId: text('run_id'),
  nodeId: text('node_id'),
  facet: text('facet').notNull(),
  url: text('url').notNull(),
  filename: text('filename').notNull(),
  originalName: text('original_name'),
  mimeType: text('mime_type'),
  fileSize: integer('file_size'),
  ordering: integer('ordering').default(0),
  metaJson: jsonb('meta_json').$type<Record<string, unknown>>().default({}),
  uploadedBy: text('uploaded_by'),
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

export const capabilitySnippets = pgTable(
  'flex_capability_snippets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    corpusId: text('corpus_id').notNull(),
    chunkId: text('chunk_id').notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    body: text('body').notNull(),
    tags: jsonb('tags').$type<string[]>().default(sql`'[]'::jsonb`).notNull(),
    source: text('source').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }).notNull(),
    embeddingModel: text('embedding_model').notNull(),
    scoreBoost: numeric('score_boost').default('0').notNull(),
    metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default(sql`'{}'::jsonb`).notNull(),
    refreshedAt: timestamp('refreshed_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    corpusIdx: index('flex_capability_snippets_corpus_idx').on(table.corpusId),
    chunkUnique: unique('flex_capability_snippets_chunk_unique').on(table.corpusId, table.chunkId)
  })
)

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
  fetchIntervalMinutes: integer('fetch_interval_minutes').notNull().default(60),
  nextFetchAt: timestamp('next_fetch_at', { withTimezone: true }).default(sql`now()`),
  lastFetchStartedAt: timestamp('last_fetch_started_at', { withTimezone: true }),
  lastFetchCompletedAt: timestamp('last_fetch_completed_at', { withTimezone: true }),
  lastFetchStatus: text('last_fetch_status').$type<'idle' | 'running' | 'success' | 'failure'>().default('idle'),
  lastFailureReason: text('last_failure_reason'),
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
  consecutiveFailureCount: integer('consecutive_failure_count').notNull().default(0),
  healthJson: jsonb('health_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (table) => ({
  clientSourceIdentifierUnique: unique('discovery_sources_client_identifier_unique').on(table.clientId, table.sourceType, table.identifier),
  clientSourceIdentifierLowerUnique: uniqueIndex('discovery_sources_client_identifier_lower_unique').on(
    table.clientId,
    table.sourceType,
    sql`lower(${table.identifier})`,
  ),
 }))

export const discoveryKeywords = pgTable('discovery_keywords', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  keyword: text('keyword').notNull(),
  keywordAlias: text('keyword_alias').notNull(),
  addedBy: text('added_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  clientKeywordAliasUnique: unique('discovery_keywords_client_alias_unique').on(table.clientId, table.keywordAlias)
}))

export const discoveryIngestRuns = pgTable('discovery_ingest_runs', {
  id: uuid('id').primaryKey(),
  runId: text('run_id').notNull(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  sourceId: uuid('source_id').references(() => discoverySources.id, { onDelete: 'cascade' }).notNull(),
  status: text('status').$type<'running' | 'succeeded' | 'failed'>().notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  durationMs: integer('duration_ms'),
  failureReason: text('failure_reason'),
  retryInMinutes: integer('retry_in_minutes'),
  metricsJson: jsonb('metrics_json').$type<Record<string, unknown>>().default({}),
  telemetryJson: jsonb('telemetry_json').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  runIdUnique: unique('discovery_ingest_runs_run_id_unique').on(table.runId),
}))

export const discoveryItems = pgTable('discovery_items', {
  id: uuid('id').primaryKey(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  sourceId: uuid('source_id').references(() => discoverySources.id, { onDelete: 'cascade' }).notNull(),
  externalId: text('external_id').notNull(),
  rawHash: text('raw_hash').notNull(),
  status: text('status').$type<'pending_scoring' | 'scored' | 'suppressed' | 'promoted' | 'archived'>().default('pending_scoring').notNull(),
  title: text('title').notNull(),
  url: text('url').notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  publishedAtSource: text('published_at_source').$type<'original' | 'fallback' | 'feed' | 'api'>().notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow(),
  rawPayloadJson: jsonb('raw_payload_json').$type<Record<string, unknown>>().notNull(),
  normalizedJson: jsonb('normalized_json').$type<Record<string, unknown>>().notNull(),
  sourceMetadataJson: jsonb('source_metadata_json').$type<Record<string, unknown>>().notNull(),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
}, (table) => ({
  clientHashUnique: uniqueIndex('discovery_items_client_hash_unique').on(table.clientId, table.rawHash),
  statusIdx: index('discovery_items_status_idx').on(table.status),
  sourceIdx: index('discovery_items_source_idx').on(table.sourceId),
}))

export const discoveryScores = pgTable('discovery_scores', {
  itemId: uuid('item_id')
    .references(() => discoveryItems.id, { onDelete: 'cascade' })
    .primaryKey()
    .notNull(),
  score: numeric('score').notNull(),
  keywordScore: numeric('keyword_score').default('0').notNull(),
  recencyScore: numeric('recency_score').default('0').notNull(),
  sourceScore: numeric('source_score').default('0').notNull(),
  appliedThreshold: numeric('applied_threshold').notNull(),
  weightsVersion: integer('weights_version').default(1).notNull(),
  componentsJson: jsonb('components_json').$type<Record<string, unknown>>().default({}).notNull(),
  rationaleJson: jsonb('rationale_json').$type<Record<string, unknown> | null>().default(null),
  knobsHintJson: jsonb('knobs_hint_json').$type<Record<string, unknown> | null>().default(null),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default({}).notNull(),
  statusOutcome: text('status_outcome').$type<'scored' | 'suppressed'>().notNull(),
  scoredAt: timestamp('scored_at', { withTimezone: true }).defaultNow().notNull(),
})

export const discoveryItemStatusHistory = pgTable('discovery_item_status_history', {
  id: uuid('id').primaryKey(),
  itemId: uuid('item_id').references(() => discoveryItems.id, { onDelete: 'cascade' }).notNull(),
  previousStatus: text('previous_status').$type<'pending_scoring' | 'scored' | 'suppressed' | 'promoted' | 'archived'>(),
  nextStatus: text('next_status').$type<'pending_scoring' | 'scored' | 'suppressed' | 'promoted' | 'archived'>().notNull(),
  note: text('note').notNull(),
  actorId: uuid('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  itemIdx: index('discovery_item_status_history_item_idx').on(table.itemId),
  createdIdx: index('discovery_item_status_history_created_idx').on(table.createdAt),
}))

export const discoveryBulkActionAudits = pgTable('discovery_bulk_action_audits', {
  id: uuid('id').primaryKey(),
  actionId: uuid('action_id').notNull().unique(),
  clientId: uuid('client_id').references(() => clients.id, { onDelete: 'cascade' }).notNull(),
  actorId: uuid('actor_id').notNull(),
  actorName: text('actor_name').notNull(),
  action: text('action').$type<'promote' | 'archive'>().notNull(),
  note: text('note'),
  filtersSnapshot: jsonb('filters_snapshot').$type<Record<string, unknown> | null>().default(null),
  itemIds: uuid('item_ids').array().$type<string[]>().notNull().default(sql`ARRAY[]::uuid[]`),
  successIds: uuid('success_ids').array().$type<string[]>().notNull().default(sql`ARRAY[]::uuid[]`),
  conflictIds: uuid('conflict_ids').array().$type<string[]>().notNull().default(sql`ARRAY[]::uuid[]`),
  failedIds: uuid('failed_ids').array().$type<string[]>().notNull().default(sql`ARRAY[]::uuid[]`),
  successBriefIds: uuid('success_brief_ids').array().$type<string[]>().notNull().default(sql`ARRAY[]::uuid[]`),
  resultsJson: jsonb('results_json').$type<Array<Record<string, unknown>>>().notNull(),
  successCount: integer('success_count').notNull().default(0),
  conflictCount: integer('conflict_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  totalCount: integer('total_count').notNull(),
  durationMs: integer('duration_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  clientIdx: index('discovery_bulk_action_audits_client_idx').on(table.clientId, table.createdAt),
  actionIdx: index('discovery_bulk_action_audits_action_idx').on(table.action, table.createdAt),
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

export const flexRuns = pgTable('flex_runs', {
  runId: text('run_id').primaryKey(),
  threadId: text('thread_id'),
  status: text('status')
    .$type<'pending' | 'running' | 'awaiting_hitl' | 'awaiting_human' | 'completed' | 'failed' | 'cancelled'>()
    .default('pending'),
  objective: text('objective'),
  envelopeJson: jsonb('envelope_json').$type<Record<string, unknown>>().notNull(),
  schemaHash: text('schema_hash'),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown>>().default({}),
  resultJson: jsonb('result_json').$type<Record<string, unknown> | null>().default(null),
  contextSnapshotJson: jsonb('context_snapshot_json').$type<Record<string, unknown>>().default({}),
  planVersion: integer('plan_version').default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
})

export const flexPlanNodes = pgTable(
  'flex_plan_nodes',
  {
    runId: text('run_id')
      .notNull()
      .references(() => flexRuns.runId, { onDelete: 'cascade' }),
    nodeId: text('node_id').notNull(),
    capabilityId: text('capability_id'),
    label: text('label'),
    status: text('status')
      .$type<'pending' | 'running' | 'completed' | 'error' | 'awaiting_hitl' | 'awaiting_human'>()
      .default('pending'),
    contextJson: jsonb('context_json').$type<Record<string, unknown>>().default({}),
    outputJson: jsonb('output_json').$type<Record<string, unknown> | null>().default(null),
    errorJson: jsonb('error_json').$type<Record<string, unknown> | null>().default(null),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.nodeId] }),
    statusIdx: index('flex_plan_nodes_status_idx').on(table.status)
  })
)

export const flexPlanSnapshots = pgTable(
  'flex_plan_snapshots',
  {
    runId: text('run_id')
      .notNull()
      .references(() => flexRuns.runId, { onDelete: 'cascade' }),
    planVersion: integer('plan_version').notNull(),
    snapshotJson: jsonb('snapshot_json').$type<Record<string, unknown>>().notNull(),
    facetSnapshotJson: jsonb('facet_snapshot_json').$type<Record<string, unknown> | null>().default(null),
    schemaHash: text('schema_hash'),
    pendingNodeIds: text('pending_node_ids').array().$type<string[]>().notNull().default(sql`ARRAY[]::text[]`),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
  },
  (table) => ({
    pk: primaryKey({ columns: [table.runId, table.planVersion] })
  })
)

export const flexRunOutputs = pgTable('flex_run_outputs', {
  runId: text('run_id')
    .primaryKey()
    .references(() => flexRuns.runId, { onDelete: 'cascade' }),
  planVersion: integer('plan_version').notNull(),
  schemaHash: text('schema_hash'),
  status: text('status')
    .$type<'pending' | 'awaiting_hitl' | 'completed' | 'failed'>()
    .notNull()
    .default('pending'),
  outputJson: jsonb('output_json').$type<Record<string, unknown>>().notNull(),
  facetSnapshotJson: jsonb('facet_snapshot_json').$type<Record<string, unknown> | null>().default(null),
  provenanceJson: jsonb('provenance_json').$type<Record<string, unknown> | null>().default(null),
  recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
})

export const hitlRequests = pgTable('hitl_requests', {
  id: text('id').primaryKey(),
  runId: text('run_id').references(() => orchestratorRuns.runId, { onDelete: 'cascade' }),
  briefId: uuid('brief_id').references(() => briefs.id, { onDelete: 'set null' }),
  threadId: text('thread_id'),
  stepId: text('step_id'),
  pendingNodeId: text('pending_node_id'),
  originAgent: text('origin_agent').$type<'strategy' | 'generation' | 'qa'>(),
  status: text('status').$type<'pending' | 'resolved' | 'denied'>().default('pending'),
  payloadJson: jsonb('payload_json').$type<Record<string, unknown>>().notNull(),
  contractSummaryJson: jsonb('contract_summary_json')
    .$type<Record<string, unknown> | null>()
    .default(null),
  operatorPrompt: text('operator_prompt'),
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

export const flexCapabilities = pgTable('flex_capabilities', {
  capabilityId: text('capability_id').notNull(),
  version: text('version').notNull(),
  displayName: text('display_name').notNull(),
  summary: text('summary').notNull(),
  agentType: text('agent_type').$type<'ai' | 'human'>().notNull().default('ai'),
  inputTraitsJson: jsonb('input_traits_json').$type<Record<string, unknown> | null>().default(null),
  inputContractJson: jsonb('input_contract_json').$type<Record<string, unknown> | null>().default(null),
  outputContractJson: jsonb('output_contract_json').$type<Record<string, unknown> | null>().default(null),
  inputFacets: text('input_facets').array().default(sql`ARRAY[]::text[]`),
  outputFacets: text('output_facets').array().default(sql`ARRAY[]::text[]`),
  costJson: jsonb('cost_json').$type<Record<string, unknown> | null>().default(null),
  preferredModels: text('preferred_models').array().default(sql`ARRAY[]::text[]`),
  heartbeatJson: jsonb('heartbeat_json').$type<Record<string, unknown> | null>().default(null),
  instructionTemplatesJson: jsonb('instruction_templates_json').$type<Record<string, unknown> | null>().default(null),
  assignmentDefaultsJson: jsonb('assignment_defaults_json').$type<Record<string, unknown> | null>().default(null),
  metadataJson: jsonb('metadata_json').$type<Record<string, unknown> | null>().default(null),
  status: text('status').$type<'active' | 'inactive'>().notNull().default('active'),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  registeredAt: timestamp('registered_at', { withTimezone: true }).defaultNow(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow()
}, (table) => ({
  pk: primaryKey({ columns: [table.capabilityId] }),
  statusIdx: index('flex_capabilities_status_idx').on(table.status),
  lastSeenIdx: index('flex_capabilities_last_seen_idx').on(table.lastSeenAt)
}))
