import { eq } from 'drizzle-orm';
import { g as getDb, c as clients, n as clientProfiles, a as assets } from '../../../_/client.mjs';
import { d as defineEventHandler, r as readBody, c as createError } from '../../../nitro/nitro.mjs';
import { u as updateClientSchema } from '../../../_/schemas.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'zod';

function normalizeTonePreset(tone) {
  if (!tone || typeof tone !== "object") return tone;
  const presetRaw = tone["preset"];
  const preset = typeof presetRaw === "string" ? presetRaw : void 0;
  let mapped = preset;
  if (preset === "Professional") mapped = "Professional & Formal";
  else if (preset === "Friendly") mapped = "Warm & Friendly";
  else if (preset === "Bold") mapped = "Confident & Bold";
  if (!mapped) {
    const legacyStyle = tone["style"];
    if (legacyStyle === "Professional") mapped = "Professional & Formal";
    else if (legacyStyle === "Friendly") mapped = "Warm & Friendly";
    else if (legacyStyle === "Bold") mapped = "Confident & Bold";
  }
  return { ...tone, preset: mapped };
}
const updateClient_patch = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  try {
    const body = await readBody(event);
    console.log("=== PATCH REQUEST START ===");
    console.log("Full body:", body);
    const parsed = updateClientSchema.safeParse(body);
    if (!parsed.success) {
      console.log("Validation failed:", parsed.error.message);
      throw createError({
        statusCode: 400,
        statusMessage: `Invalid request data: ${parsed.error.message}`
      });
    }
    const { clientId, name, slug, website, industry, settings, profile, assets: assetsData } = parsed.data;
    console.log("Validation passed, getting database connection...");
    const db = getDb();
    console.log("Database connection obtained");
    console.log("Checking if client exists...");
    const [existingClient] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    console.log("Existing client found:", existingClient);
    if (!existingClient) {
      console.log("Client not found in database");
      throw createError({ statusCode: 404, statusMessage: "Client not found" });
    }
    if (slug && slug !== existingClient.slug) {
      console.log("Checking for slug conflicts...");
      const [slugConflict] = await db.select().from(clients).where(eq(clients.slug, slug)).limit(1);
      console.log("Slug conflict check result:", slugConflict);
      if (slugConflict && slugConflict.id !== clientId) {
        console.log("Slug conflict detected");
        throw createError({
          statusCode: 400,
          statusMessage: "Slug is already taken by another client"
        });
      }
    }
    const clientUpdateFields = {};
    if (name !== void 0) clientUpdateFields.name = name.trim();
    if (slug !== void 0) clientUpdateFields.slug = slug.trim();
    if (website !== void 0) clientUpdateFields.website = website;
    if (industry !== void 0) clientUpdateFields.industry = industry;
    if (settings !== void 0) clientUpdateFields.settingsJson = settings;
    if (Object.keys(clientUpdateFields).length > 0) {
      console.log("Starting client update with fields:", clientUpdateFields);
      await db.update(clients).set(clientUpdateFields).where(eq(clients.id, clientId));
      console.log("Client updated successfully");
    }
    if (profile) {
      console.log("Handling profile updates...");
      const [existingProfile] = await db.select().from(clientProfiles).where(eq(clientProfiles.clientId, clientId)).limit(1);
      if (existingProfile) {
        const profileUpdateFields = {};
        if (profile.primaryCommunicationLanguage !== void 0) profileUpdateFields.primaryCommunicationLanguage = profile.primaryCommunicationLanguage;
        if (profile.objectives !== void 0) profileUpdateFields.objectivesJson = profile.objectives;
        if (profile.audiences !== void 0) profileUpdateFields.audiencesJson = profile.audiences;
        if (profile.tone !== void 0) profileUpdateFields.toneJson = normalizeTonePreset(profile.tone);
        if (profile.specialInstructions !== void 0) profileUpdateFields.specialInstructionsJson = profile.specialInstructions;
        if (profile.guardrails !== void 0) profileUpdateFields.guardrailsJson = profile.guardrails;
        if (profile.platformPrefs !== void 0) profileUpdateFields.platformPrefsJson = profile.platformPrefs;
        if (profile.permissions !== void 0) profileUpdateFields.permissionsJson = profile.permissions;
        if (Object.keys(profileUpdateFields).length > 0) {
          profileUpdateFields.updatedAt = /* @__PURE__ */ new Date();
          await db.update(clientProfiles).set(profileUpdateFields).where(eq(clientProfiles.id, existingProfile.id));
          console.log("Profile updated successfully");
        }
      } else {
        const profileId = crypto.randomUUID();
        await db.insert(clientProfiles).values({
          id: profileId,
          clientId,
          primaryCommunicationLanguage: (_a = profile.primaryCommunicationLanguage) != null ? _a : null,
          objectivesJson: (_b = profile.objectives) != null ? _b : {},
          audiencesJson: (_c = profile.audiences) != null ? _c : {},
          toneJson: (_d = normalizeTonePreset(profile.tone)) != null ? _d : {},
          specialInstructionsJson: (_e = profile.specialInstructions) != null ? _e : {},
          guardrailsJson: (_f = profile.guardrails) != null ? _f : {},
          platformPrefsJson: (_g = profile.platformPrefs) != null ? _g : {},
          permissionsJson: (_h = profile.permissions) != null ? _h : {},
          updatedAt: /* @__PURE__ */ new Date()
        });
        console.log("New profile created successfully");
      }
    }
    if (assetsData) {
      console.log("Handling assets management...");
      if (assetsData.delete && assetsData.delete.length > 0) {
        console.log("Deleting assets:", assetsData.delete);
        for (const assetId of assetsData.delete) {
          await db.delete(assets).where(eq(assets.id, assetId));
        }
        console.log("Assets deleted successfully");
      }
      if (assetsData.add && assetsData.add.length > 0) {
        console.log("Adding new assets:", assetsData.add);
        for (const asset of assetsData.add) {
          const assetId = crypto.randomUUID();
          const downloadUrl = `/api/assets/${assetId}/download`;
          await db.insert(assets).values({
            id: assetId,
            clientId,
            briefId: null,
            filename: (_i = asset.url.split("/").pop()) != null ? _i : "unknown",
            originalName: (_j = asset.url.split("/").pop()) != null ? _j : "unknown",
            url: downloadUrl,
            type: (_k = asset.type) != null ? _k : null,
            mimeType: null,
            fileSize: null,
            metaJson: (_l = asset.meta) != null ? _l : {},
            createdBy: null
          });
        }
        console.log("New assets added successfully");
      }
    }
    console.log("Fetching updated data...");
    const [updatedClient] = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
    const [updatedProfile] = await db.select().from(clientProfiles).where(eq(clientProfiles.clientId, clientId)).limit(1);
    const clientAssets = await db.select().from(assets).where(
      eq(assets.clientId, clientId)
    ).then((assets2) => assets2.filter((asset) => asset.briefId === null));
    console.log("Update completed successfully");
    return {
      ok: true,
      message: "Client updated successfully",
      client: {
        id: clientId,
        name: updatedClient.name,
        slug: updatedClient.slug,
        website: updatedClient.website,
        industry: updatedClient.industry,
        settings: updatedClient.settingsJson,
        createdAt: updatedClient.createdAt
      },
      profile: updatedProfile ? {
        id: updatedProfile.id,
        primaryLanguage: updatedProfile.primaryCommunicationLanguage,
        objectives: updatedProfile.objectivesJson,
        audiences: updatedProfile.audiencesJson,
        tone: updatedProfile.toneJson,
        guardrails: updatedProfile.guardrailsJson,
        platformPrefs: updatedProfile.platformPrefsJson,
        permissions: updatedProfile.permissionsJson,
        updatedAt: updatedProfile.updatedAt
      } : null,
      assets: clientAssets.map((asset) => ({
        id: asset.id,
        url: asset.url,
        type: asset.type,
        meta: asset.metaJson
      }))
    };
  } catch (error) {
    console.error("=== ERROR IN PATCH ENDPOINT ===");
    console.error("Error type:", typeof error);
    console.error("Error message:", error instanceof Error ? error.message : String(error));
    console.error("Error stack:", error instanceof Error ? error.stack : "No stack trace");
    if (error instanceof Error && error.message.includes("Client not found")) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("Slug is already taken")) {
      throw error;
    }
    if (error instanceof Error && error.message.includes("Invalid request data")) {
      throw error;
    }
    throw createError({
      statusCode: 500,
      statusMessage: `Failed to update client: ${error instanceof Error ? error.message : String(error)}`
    });
  }
});

export { updateClient_patch as default };
//# sourceMappingURL=update-client.patch.mjs.map
