import { d as defineEventHandler, g as getQuery } from '../../nitro/nitro.mjs';
import { eq } from 'drizzle-orm';
import { g as getDb, a as assets } from '../../_/client.mjs';
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
  const query = getQuery(event);
  const clientId = query.clientId;
  const db = getDb();
  let rows;
  if (clientId) {
    rows = await db.select().from(assets).where(
      eq(assets.clientId, clientId)
    ).then((assets2) => assets2.filter((asset) => asset.briefId === null));
  } else {
    rows = await db.select().from(assets).limit(100);
  }
  return { ok: true, assets: rows };
});

export { index_get as default };
//# sourceMappingURL=index.get.mjs.map
