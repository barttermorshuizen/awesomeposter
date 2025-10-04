import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import { g as getDb, a as assets } from '../../../../_/index.mjs';
import { eq } from 'drizzle-orm';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';

const assets_get = defineEventHandler(async (event) => {
  const briefId = getRouterParam(event, "id");
  if (!briefId) throw createError({ statusCode: 400, statusMessage: "Brief ID required" });
  const db = getDb();
  const briefAssets = await db.select().from(assets).where(eq(assets.briefId, briefId));
  const transformedAssets = briefAssets.map((asset) => ({
    id: asset.id,
    filename: asset.filename || "",
    originalName: asset.originalName || "",
    url: asset.url,
    type: asset.type || "other",
    mimeType: asset.mimeType || "",
    fileSize: asset.fileSize || 0,
    metaJson: asset.metaJson || {}
  }));
  return { ok: true, assets: transformedAssets };
});

export { assets_get as default };
//# sourceMappingURL=assets.get.mjs.map
