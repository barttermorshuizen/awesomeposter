import { d as defineEventHandler } from '../../nitro/nitro.mjs';
import { g as getDb, t as tasks } from '../../_/index.mjs';
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
  const db = getDb();
  const rows = await db.select().from(tasks).limit(50);
  return { ok: true, items: rows };
});

export { index_get as default };
//# sourceMappingURL=index.get4.mjs.map
