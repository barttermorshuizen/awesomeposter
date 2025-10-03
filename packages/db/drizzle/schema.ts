import { pgTable, foreignKey, uuid, jsonb, timestamp, text, unique, integer, primaryKey, boolean } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const clientProfiles = pgTable("client_profiles", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	objectivesJson: jsonb("objectives_json").notNull(),
	audiencesJson: jsonb("audiences_json").notNull(),
	toneJson: jsonb("tone_json").default({}),
	guardrailsJson: jsonb("guardrails_json").default({}),
	platformPrefsJson: jsonb("platform_prefs_json").default({}),
	permissionsJson: jsonb("permissions_json").default({}),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "client_profiles_client_id_clients_id_fk"
		}).onDelete("cascade"),
]);

export const briefs = pgTable("briefs", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	title: text(),
	status: text().default('draft'),
	objective: text(),
	audienceId: text("audience_id"),
	deadlineAt: timestamp("deadline_at", { withTimezone: true, mode: 'string' }),
	createdBy: uuid("created_by"),
	updatedBy: uuid("updated_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	description: text(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "briefs_client_id_clients_id_fk"
		}).onDelete("cascade"),
]);

export const emailsIngested = pgTable("emails_ingested", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	provider: text(),
	providerEventId: text("provider_event_id"),
	messageId: text("message_id"),
	fromEmail: text("from_email"),
	toEmail: text("to_email"),
	subject: text(),
	rawUrl: text("raw_url"),
	parsedJson: jsonb("parsed_json"),
	status: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const examplesIndex = pgTable("examples_index", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	platform: text(),
	embedding: jsonb(),
	metaJson: jsonb("meta_json"),
	perfJson: jsonb("perf_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const tasks = pgTable("tasks", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	type: text(),
	assigneeId: uuid("assignee_id"),
	status: text(),
	dueAt: timestamp("due_at", { withTimezone: true, mode: 'string' }),
	payloadJson: jsonb("payload_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
});

export const discoverySources = pgTable("discovery_sources", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	url: text().notNull(),
	canonicalUrl: text("canonical_url").notNull(),
	sourceType: text("source_type").notNull(),
	identifier: text().notNull(),
	notes: text(),
	configJson: jsonb("config_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "discovery_sources_client_id_clients_id_fk"
		}).onDelete("cascade"),
	unique("discovery_sources_client_identifier_unique").on(table.clientId, table.sourceType, table.identifier),
	unique("discovery_sources_client_identifier_lower_unique").on(table.clientId, table.sourceType, sql`lower(${table.identifier})`),
]);

export const discoveryKeywords = pgTable("discovery_keywords", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id").notNull(),
	keyword: text().notNull(),
	keywordAlias: text("keyword_alias").notNull(),
	addedBy: text("added_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "discovery_keywords_client_id_clients_id_fk"
		}).onDelete("cascade"),
	unique("discovery_keywords_client_alias_unique").on(table.clientId, table.keywordAlias),
]);

export const clients = pgTable("clients", {
	id: uuid().primaryKey().notNull(),
	name: text().notNull(),
	slug: text(),
	settingsJson: jsonb("settings_json").default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	unique("clients_slug_unique").on(table.slug),
]);

export const experiments = pgTable("experiments", {
	id: uuid().primaryKey().notNull(),
	briefId: uuid("brief_id"),
	policy: text(),
	armJson: jsonb("arm_json"),
	resultJson: jsonb("result_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.briefId],
			foreignColumns: [briefs.id],
			name: "experiments_brief_id_briefs_id_fk"
		}).onDelete("cascade"),
]);

export const posts = pgTable("posts", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	platform: text(),
	briefId: uuid("brief_id"),
	variantId: text("variant_id"),
	contentJson: jsonb("content_json"),
	knobsJson: jsonb("knobs_json"),
	status: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "posts_client_id_clients_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.briefId],
			foreignColumns: [briefs.id],
			name: "posts_brief_id_briefs_id_fk"
		}).onDelete("set null"),
]);

export const assets = pgTable("assets", {
	id: uuid().primaryKey().notNull(),
	clientId: uuid("client_id"),
	briefId: uuid("brief_id"),
	url: text().notNull(),
	type: text(),
	metaJson: jsonb("meta_json").default({}),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	filename: text(),
	originalName: text("original_name"),
	mimeType: text("mime_type"),
	fileSize: integer("file_size"),
	createdBy: uuid("created_by"),
}, (table) => [
	foreignKey({
			columns: [table.clientId],
			foreignColumns: [clients.id],
			name: "assets_client_id_clients_id_fk"
		}).onDelete("cascade"),
	foreignKey({
			columns: [table.briefId],
			foreignColumns: [briefs.id],
			name: "assets_brief_id_briefs_id_fk"
		}).onDelete("cascade"),
]);

export const briefVersions = pgTable("brief_versions", {
	briefId: uuid("brief_id").notNull(),
	version: integer().notNull(),
	diffJson: jsonb("diff_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow(),
	createdBy: uuid("created_by"),
}, (table) => [
	foreignKey({
			columns: [table.briefId],
			foreignColumns: [briefs.id],
			name: "brief_versions_brief_id_briefs_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.briefId, table.version], name: "brief_versions_brief_id_version_pk"}),
]);

export const postMetrics = pgTable("post_metrics", {
	postId: uuid("post_id").notNull(),
	capturedAt: timestamp("captured_at", { withTimezone: true, mode: 'string' }).notNull(),
	impressions: integer(),
	reactions: integer(),
	comments: integer(),
	shares: integer(),
	clicks: integer(),
	ctr: text(),
	isBoosted: boolean("is_boosted").default(false),
}, (table) => [
	foreignKey({
			columns: [table.postId],
			foreignColumns: [posts.id],
			name: "post_metrics_post_id_posts_id_fk"
		}).onDelete("cascade"),
	primaryKey({ columns: [table.postId, table.capturedAt], name: "post_metrics_post_id_captured_at_pk"}),
]);
