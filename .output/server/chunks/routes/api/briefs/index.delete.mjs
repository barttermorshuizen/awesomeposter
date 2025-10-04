import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../nitro/nitro.mjs';
import { g as getDb, b as briefs, a as assets } from '../../../_/index.mjs';
import { deleteBriefAssets } from '../../../_/storage.mjs';
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
  const briefId = getRouterParam(event, "id");
  if (!briefId) throw createError({ statusCode: 400, statusMessage: "Brief ID required" });
  const db = getDb();
  const [brief] = await db.select().from(briefs).where(eq(briefs.id, briefId)).limit(1);
  if (!brief) {
    throw createError({ statusCode: 404, statusMessage: "Brief not found" });
  }
  const briefAssets = await db.select().from(assets).where(eq(assets.briefId, briefId));
  await db.delete(assets).where(eq(assets.briefId, briefId));
  await db.delete(briefs).where(eq(briefs.id, briefId));
  try {
    for (const asset of briefAssets) {
      if (asset.filename) {
        try {
          const { deleteAssetObject } = await import('../../../_/storage.mjs');
          await deleteAssetObject(asset.filename);
        } catch (error) {
          console.error("Failed to delete individual asset from R2:", asset.filename, error);
        }
      }
    }
    await deleteBriefAssets(briefId);
  } catch (error) {
    console.error("Failed to delete brief assets from R2:", error);
  }
  return { ok: true, message: "Brief deleted successfully" };
});

export { index_delete as default };
//# sourceMappingURL=index.delete.mjs.map
