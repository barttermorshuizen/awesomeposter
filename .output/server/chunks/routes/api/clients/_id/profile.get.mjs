import { i as getPool } from '../../../../_/index.mjs';
import { g as generateMinimalClientProfile, v as validateClientProfileStructure } from '../../../../_/sample-client-profile.mjs';
import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

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
const profile_get = defineEventHandler(async (event) => {
  var _a;
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "id required" });
  }
  const pool = getPool();
  let clientName = null;
  try {
    const { rows: crows } = await pool.query(
      "SELECT name FROM clients WHERE id = $1 LIMIT 1",
      [id]
    );
    clientName = ((_a = crows == null ? void 0 : crows[0]) == null ? void 0 : _a.name) || null;
  } catch {
  }
  const { rows } = await pool.query(
    "SELECT * FROM client_profiles WHERE client_id = $1 LIMIT 1",
    [id]
  );
  const row = rows[0];
  if (!row) {
    const minimalProfile = generateMinimalClientProfile();
    return {
      ok: true,
      profile: {
        id: null,
        clientId: id,
        clientName,
        primaryLanguage: minimalProfile.primaryCommunicationLanguage,
        objectives: minimalProfile.objectivesJson,
        audiences: minimalProfile.audiencesJson,
        tone: minimalProfile.toneJson,
        specialInstructions: minimalProfile.specialInstructionsJson,
        guardrails: minimalProfile.guardrailsJson,
        platformPrefs: minimalProfile.platformPrefsJson,
        permissions: {},
        updatedAt: null
      }
    };
  }
  let transformedProfile = {
    id: row.id,
    clientId: row.client_id,
    clientName,
    primaryLanguage: row.primary_communication_language || "US English",
    objectives: row.objectives_json || {},
    audiences: row.audiences_json || {},
    tone: normalizeTonePreset(row.tone_json || {}),
    specialInstructions: row.special_instructions_json || {},
    guardrails: row.guardrails_json || {},
    platformPrefs: row.platform_prefs_json || {},
    permissions: row.permissions_json || {},
    updatedAt: row.updated_at
  };
  const validation = validateClientProfileStructure({
    primaryCommunicationLanguage: transformedProfile.primaryLanguage,
    objectivesJson: transformedProfile.objectives,
    audiencesJson: transformedProfile.audiences,
    toneJson: transformedProfile.tone,
    specialInstructionsJson: transformedProfile.specialInstructions,
    guardrailsJson: transformedProfile.guardrails,
    platformPrefsJson: transformedProfile.platformPrefs
  });
  if (!validation.isValid) {
    console.log(`\u26A0\uFE0F Client profile ${id} has missing fields:`, validation.missingFields);
    const minimalDefaults = generateMinimalClientProfile(transformedProfile.primaryLanguage);
    transformedProfile = {
      ...transformedProfile,
      objectives: !transformedProfile.objectives || Object.keys(transformedProfile.objectives).length === 0 ? minimalDefaults.objectivesJson : transformedProfile.objectives,
      audiences: !transformedProfile.audiences || Object.keys(transformedProfile.audiences).length === 0 ? minimalDefaults.audiencesJson : transformedProfile.audiences,
      tone: !transformedProfile.tone || Object.keys(transformedProfile.tone).length === 0 ? minimalDefaults.toneJson : transformedProfile.tone,
      specialInstructions: !transformedProfile.specialInstructions || Object.keys(transformedProfile.specialInstructions).length === 0 ? minimalDefaults.specialInstructionsJson : transformedProfile.specialInstructions,
      guardrails: !transformedProfile.guardrails || Object.keys(transformedProfile.guardrails).length === 0 ? minimalDefaults.guardrailsJson : transformedProfile.guardrails,
      platformPrefs: !transformedProfile.platformPrefs || Object.keys(transformedProfile.platformPrefs).length === 0 ? minimalDefaults.platformPrefsJson : transformedProfile.platformPrefs
    };
  }
  return { ok: true, profile: transformedProfile };
});

export { profile_get as default };
//# sourceMappingURL=profile.get.mjs.map
