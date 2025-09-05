globalThis.__timing__.logStart('Load chunks/routes/api/v1/health/db.get');import { d as defineEventHandler } from '../../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const db_get = defineEventHandler(async () => {
  try {
    const { AgentsDatabaseService } = await import('../../../../_/database.mjs');
    const ok = await new AgentsDatabaseService().healthCheck();
    return { ok, driver: "pg", timestamp: (/* @__PURE__ */ new Date()).toISOString() };
  } catch (err) {
    return { ok: false, driver: "pg", error: (err == null ? void 0 : err.message) || "Unknown DB error", timestamp: (/* @__PURE__ */ new Date()).toISOString() };
  }
});

export { db_get as default };;globalThis.__timing__.logEnd('Load chunks/routes/api/v1/health/db.get');
//# sourceMappingURL=db.get.mjs.map
