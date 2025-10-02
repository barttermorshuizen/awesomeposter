import { relations } from "drizzle-orm/relations";
import { clients, clientProfiles, briefs, experiments, posts, assets, briefVersions, postMetrics, discoverySources, discoveryKeywords } from "./schema";

export const clientProfilesRelations = relations(clientProfiles, ({one}) => ({
	client: one(clients, {
		fields: [clientProfiles.clientId],
		references: [clients.id]
	}),
}));

export const clientsRelations = relations(clients, ({many}) => ({
	clientProfiles: many(clientProfiles),
	briefs: many(briefs),
	posts: many(posts),
	assets: many(assets),
	discoverySources: many(discoverySources),
	discoveryKeywords: many(discoveryKeywords),
}));

export const briefsRelations = relations(briefs, ({one, many}) => ({
	client: one(clients, {
		fields: [briefs.clientId],
		references: [clients.id]
	}),
	experiments: many(experiments),
	posts: many(posts),
	assets: many(assets),
	briefVersions: many(briefVersions),
}));

export const experimentsRelations = relations(experiments, ({one}) => ({
	brief: one(briefs, {
		fields: [experiments.briefId],
		references: [briefs.id]
	}),
}));

export const postsRelations = relations(posts, ({one, many}) => ({
	client: one(clients, {
		fields: [posts.clientId],
		references: [clients.id]
	}),
	brief: one(briefs, {
		fields: [posts.briefId],
		references: [briefs.id]
	}),
	postMetrics: many(postMetrics),
}));

export const assetsRelations = relations(assets, ({one}) => ({
	client: one(clients, {
		fields: [assets.clientId],
		references: [clients.id]
	}),
	brief: one(briefs, {
		fields: [assets.briefId],
		references: [briefs.id]
	}),
}));

export const briefVersionsRelations = relations(briefVersions, ({one}) => ({
	brief: one(briefs, {
		fields: [briefVersions.briefId],
		references: [briefs.id]
	}),
}));

export const postMetricsRelations = relations(postMetrics, ({one}) => ({
	post: one(posts, {
		fields: [postMetrics.postId],
		references: [posts.id]
	}),
}));

export const discoverySourcesRelations = relations(discoverySources, ({one}) => ({
	client: one(clients, {
		fields: [discoverySources.clientId],
		references: [clients.id]
	}),
}));

export const discoveryKeywordsRelations = relations(discoveryKeywords, ({one}) => ({
	client: one(clients, {
		fields: [discoveryKeywords.clientId],
		references: [clients.id]
	}),
}));
