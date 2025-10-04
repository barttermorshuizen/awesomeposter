import { g as getDb, b as briefs } from '../../../../_/index.mjs';
import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
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

const approve_post = defineEventHandler(async (event) => {
  var _a;
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });
  try {
    const db = getDb();
    const [row] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
    if (!row) {
      throw createError({ statusCode: 404, statusMessage: "Not found" });
    }
    const status = (_a = row.status) != null ? _a : null;
    if (status !== "draft") {
      throw createError({ statusCode: 400, statusMessage: "Only Draft briefs can be approved" });
    }
    await db.update(briefs).set({ status: "approved" }).where(eq(briefs.id, id));
    return { ok: true };
  } catch (err) {
    if (err instanceof Error && err.message.includes("DATABASE_URL is not set")) {
      return { ok: true };
    }
    throw err;
  }
});

export { approve_post as default };
//# sourceMappingURL=approve.post.mjs.map
