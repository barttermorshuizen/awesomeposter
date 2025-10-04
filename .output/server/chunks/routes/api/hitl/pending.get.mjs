import { d as defineEventHandler } from '../../../nitro/nitro.mjs';
import { r as requireApiAuth } from '../../../_/api-auth.mjs';
import { g as getOrchestratorPersistence } from '../../../_/orchestrator-persistence.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../../../_/index.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';

const pending_get = defineEventHandler(async (event) => {
  try {
    requireApiAuth(event);
    const persistence = getOrchestratorPersistence();
    const runs = await persistence.listAwaitingHitl();
    return {
      ok: true,
      runs
    };
  } catch (err) {
    try {
      console.error("[api/hitl/pending] error:", err);
    } catch {
    }
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("DATABASE_URL") || /ECONNREFUSED|ENOTFOUND|timeout|no pg_hba|refused/i.test(msg)) {
      return { ok: true, runs: [] };
    }
    throw err;
  }
});

export { pending_get as default };
//# sourceMappingURL=pending.get.mjs.map
