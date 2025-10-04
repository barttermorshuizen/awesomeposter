import { i as getPool } from '../../../../_/index.mjs';
import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../../nitro/nitro.mjs';
import { a as createOrUpdateClientProfileSchema } from '../../../../_/schemas.mjs';
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
import 'zod';

function normalizeTonePreset(tone) {
  if (!tone || typeof tone !== "object") return tone;
  const presetRaw = tone == null ? void 0 : tone["preset"];
  const preset = typeof presetRaw === "string" ? presetRaw : void 0;
  let mapped = preset;
  if (preset === "Professional") mapped = "Professional & Formal";
  else if (preset === "Friendly") mapped = "Warm & Friendly";
  else if (preset === "Bold") mapped = "Confident & Bold";
  if (!mapped) {
    const legacyStyle = tone == null ? void 0 : tone["style"];
    if (legacyStyle === "Professional") mapped = "Professional & Formal";
    else if (legacyStyle === "Friendly") mapped = "Warm & Friendly";
    else if (legacyStyle === "Bold") mapped = "Confident & Bold";
  }
  return { ...tone, preset: mapped };
}
const profile_patch = defineEventHandler(async (event) => {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l;
  const id = getRouterParam(event, "id");
  if (!id) {
    throw createError({ statusCode: 400, statusMessage: "id required" });
  }
  const body = await readBody(event);
  const parsed = createOrUpdateClientProfileSchema.safeParse(body);
  if (!parsed.success) {
    throw createError({ statusCode: 400, statusMessage: parsed.error.message });
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query(
      "SELECT id FROM client_profiles WHERE client_id = $1 LIMIT 1",
      [id]
    );
    const now = /* @__PURE__ */ new Date();
    if (rows[0]) {
      const profileId2 = rows[0].id;
      await client.query(
        `UPDATE client_profiles SET 
           primary_communication_language = $1, objectives_json = $2, audiences_json = $3, tone_json = $4, special_instructions_json = $5, guardrails_json = $6,
           platform_prefs_json = $7, permissions_json = $8, updated_at = $9
         WHERE id = $10`,
        [
          parsed.data.primaryCommunicationLanguage || null,
          (_a = parsed.data.objectives) != null ? _a : {},
          (_b = parsed.data.audiences) != null ? _b : {},
          normalizeTonePreset(parsed.data.tone),
          (_c = parsed.data.specialInstructions) != null ? _c : {},
          (_d = parsed.data.guardrails) != null ? _d : {},
          (_e = parsed.data.platformPrefs) != null ? _e : {},
          (_f = parsed.data.permissions) != null ? _f : {},
          now,
          profileId2
        ]
      );
      await client.query("COMMIT");
      return { ok: true, id: profileId2 };
    }
    const profileId = crypto.randomUUID();
    await client.query(
      `INSERT INTO client_profiles (id, client_id, primary_communication_language, objectives_json, audiences_json, tone_json, special_instructions_json, guardrails_json, platform_prefs_json, permissions_json, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        profileId,
        id,
        parsed.data.primaryCommunicationLanguage || null,
        (_g = parsed.data.objectives) != null ? _g : {},
        (_h = parsed.data.audiences) != null ? _h : {},
        normalizeTonePreset(parsed.data.tone),
        (_i = parsed.data.specialInstructions) != null ? _i : {},
        (_j = parsed.data.guardrails) != null ? _j : {},
        (_k = parsed.data.platformPrefs) != null ? _k : {},
        (_l = parsed.data.permissions) != null ? _l : {},
        now
      ]
    );
    await client.query("COMMIT");
    return { ok: true, id: profileId };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
});

export { profile_patch as default };
//# sourceMappingURL=profile.patch.mjs.map
