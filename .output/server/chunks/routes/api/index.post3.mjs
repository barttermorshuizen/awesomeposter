import { d as defineEventHandler, r as readBody } from '../../nitro/nitro.mjs';
import { g as getDb, c as clients } from '../../_/index.mjs';
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

const index_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { name, industry, website } = body;
    if (!name) {
      throw new Error("Client name is required");
    }
    const db = getDb();
    const id = crypto.randomUUID();
    await db.insert(clients).values({
      id,
      name,
      website: website || null,
      industry: industry || null,
      createdAt: /* @__PURE__ */ new Date()
    });
    return {
      success: true,
      id,
      name
    };
  } catch (error) {
    console.error("Error creating client:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
});

export { index_post as default };
//# sourceMappingURL=index.post3.mjs.map
