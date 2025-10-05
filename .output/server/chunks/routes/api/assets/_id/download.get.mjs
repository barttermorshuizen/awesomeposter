import { d as defineEventHandler, a as getRouterParam, c as createError, s as sendRedirect } from '../../../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
import { g as getDb, a as assets } from '../../../../_/client.mjs';
import { getSignedDownloadUrl } from '../../../../_/storage.mjs';
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
import '@aws-sdk/client-s3';
import '@aws-sdk/s3-request-presigner';
import '../../../../_/env.mjs';
import 'zod';
import 'node:module';

const download_get = defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, "id");
  if (!assetId) throw createError({ statusCode: 400, statusMessage: "Asset ID required" });
  const db = getDb();
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) {
    throw createError({ statusCode: 404, statusMessage: "Asset not found" });
  }
  if (!asset.filename) {
    throw createError({ statusCode: 404, statusMessage: "Asset file not found" });
  }
  try {
    const signedUrl = await getSignedDownloadUrl(asset.filename, 300);
    return sendRedirect(event, signedUrl);
  } catch (error) {
    console.error("Failed to generate signed URL for asset:", assetId, error);
    throw createError({ statusCode: 500, statusMessage: "Failed to generate download URL" });
  }
});

export { download_get as default };
//# sourceMappingURL=download.get.mjs.map
