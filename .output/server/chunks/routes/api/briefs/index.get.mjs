import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
import { g as getDb, b as briefs } from '../../../_/client.mjs';
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

const index_get = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });
  const db = getDb();
  const [row] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
  if (!row) throw createError({ statusCode: 404, statusMessage: "Not found" });
  return { ok: true, brief: row };
});

export { index_get as default };
//# sourceMappingURL=index.get.mjs.map
