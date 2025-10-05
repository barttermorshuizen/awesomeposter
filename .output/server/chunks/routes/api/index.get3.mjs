import { d as defineEventHandler } from '../../nitro/nitro.mjs';
import { g as getDb, c as clients } from '../../_/client.mjs';
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
import 'drizzle-orm';

const index_get = defineEventHandler(async () => {
  try {
    const db = getDb();
    const rows = await db.select().from(clients).limit(100);
    return { ok: true, items: rows };
  } catch (err) {
    if (err instanceof Error && err.message.includes("DATABASE_URL is not set")) {
      return { ok: true, items: [] };
    }
    throw err;
  }
});

export { index_get as default };
//# sourceMappingURL=index.get3.mjs.map
