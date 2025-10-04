import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../nitro/nitro.mjs';
import { g as getDb, b as briefs } from '../../../_/index.mjs';
import { c as createBriefSchema } from '../../../_/schemas.mjs';
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
import 'zod';

const index_patch = defineEventHandler(async (event) => {
  const id = getRouterParam(event, "id");
  if (!id) throw createError({ statusCode: 400, statusMessage: "id required" });
  const body = await readBody(event);
  const parsed = createBriefSchema.partial().safeParse(body);
  if (!parsed.success) throw createError({ statusCode: 400, statusMessage: parsed.error.message });
  const db = getDb();
  const updateData = {};
  if (parsed.data.title !== void 0) updateData.title = parsed.data.title;
  if (parsed.data.description !== void 0) updateData.description = parsed.data.description;
  if (parsed.data.clientId !== void 0) updateData.clientId = parsed.data.clientId;
  if (parsed.data.objective !== void 0) updateData.objective = parsed.data.objective;
  if (parsed.data.audienceId !== void 0) updateData.audienceId = parsed.data.audienceId;
  if (parsed.data.deadlineAt !== void 0) {
    updateData.deadlineAt = parsed.data.deadlineAt ? new Date(parsed.data.deadlineAt) : null;
  }
  if (parsed.data.status !== void 0) updateData.status = parsed.data.status;
  console.log("[briefs.update] id", id, "updateData", updateData);
  await db.update(briefs).set(updateData).where(eq(briefs.id, id));
  const [updated] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
  return { ok: true, brief: updated };
});

export { index_patch as default };
//# sourceMappingURL=index.patch.mjs.map
