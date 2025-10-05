import { d as defineEventHandler, r as readBody, c as createError } from '../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
import { g as getDb, b as briefs } from '../../_/client.mjs';
import { c as createBriefSchema } from '../../_/schemas.mjs';
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

const index_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const parsed = createBriefSchema.safeParse(body);
    if (!parsed.success) {
      throw createError({ statusCode: 400, statusMessage: parsed.error.message });
    }
    const db = getDb();
    const { clientId, title, description, objective, audienceId, deadlineAt } = parsed.data;
    const id = crypto.randomUUID();
    await db.insert(briefs).values({
      id,
      clientId,
      title,
      description,
      objective,
      audienceId,
      deadlineAt: deadlineAt ? new Date(deadlineAt) : null
    });
    const [created] = await db.select().from(briefs).where(eq(briefs.id, id)).limit(1);
    return { ok: true, brief: created };
  } catch (error) {
    console.error("Error creating brief:", error);
    throw error;
  }
});

export { index_post as default };
//# sourceMappingURL=index.post2.mjs.map
