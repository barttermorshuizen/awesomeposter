import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../nitro/nitro.mjs';
import { g as getDb, a as assets } from '../../../_/index.mjs';
import { deleteAssetObject } from '../../../_/storage.mjs';
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
import '@aws-sdk/client-s3';
import '@aws-sdk/s3-request-presigner';
import '../../../_/env.mjs';
import 'zod';
import 'node:module';

const index_delete = defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, "id");
  if (!assetId) throw createError({ statusCode: 400, statusMessage: "Asset ID required" });
  const db = getDb();
  const [asset] = await db.select().from(assets).where(eq(assets.id, assetId)).limit(1);
  if (!asset) {
    throw createError({ statusCode: 404, statusMessage: "Asset not found" });
  }
  await db.delete(assets).where(eq(assets.id, assetId));
  if (asset.filename) {
    try {
      await deleteAssetObject(asset.filename);
    } catch (error) {
      console.error("Failed to delete asset from R2:", error);
    }
  }
  return { ok: true, message: "Asset deleted successfully" };
});

export { index_delete as default };
//# sourceMappingURL=index.delete.mjs.map
