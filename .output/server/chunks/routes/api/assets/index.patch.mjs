import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
import { g as getDb, a as assets } from '../../../_/client.mjs';
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

const index_patch = defineEventHandler(async (event) => {
  const assetId = getRouterParam(event, "id");
  if (!assetId) throw createError({ statusCode: 400, statusMessage: "Asset ID required" });
  const body = await readBody(event);
  const { briefId } = body;
  const db = getDb();
  await db.update(assets).set({
    briefId: briefId || null
  }).where(eq(assets.id, assetId));
  return { ok: true, message: "Asset updated successfully" };
});

export { index_patch as default };
//# sourceMappingURL=index.patch.mjs.map
