import { d as defineEventHandler } from '../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
import { g as getDb, b as briefs, c as clients } from '../../_/client.mjs';
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

const index_get = defineEventHandler(async () => {
  try {
    const db = getDb();
    const rows = await db.select({
      id: briefs.id,
      title: briefs.title,
      clientId: briefs.clientId,
      clientName: clients.name,
      objective: briefs.objective,
      status: briefs.status,
      audienceId: briefs.audienceId,
      deadlineAt: briefs.deadlineAt,
      createdAt: briefs.createdAt,
      updatedAt: briefs.updatedAt
    }).from(briefs).leftJoin(clients, eq(briefs.clientId, clients.id)).limit(100);
    return { ok: true, items: rows };
  } catch (err) {
    try {
      console.error("[api/briefs] list error:", err);
    } catch {
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DATABASE_URL is not set") || /ECONNREFUSED|ENOTFOUND|timeout|no pg_hba/i.test(msg)) {
      return { ok: true, items: [] };
    }
    throw err;
  }
});

export { index_get as default };
//# sourceMappingURL=index.get2.mjs.map
