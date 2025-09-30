import { d as defineEventHandler } from '../../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const health_get = defineEventHandler(async () => {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const uptime = process.uptime();
  let dbOk = false;
  try {
    const { AgentsDatabaseService } = await import('../../../_/database.mjs');
    dbOk = await new AgentsDatabaseService().healthCheck();
  } catch {
    dbOk = false;
  }
  const openaiConfigured = Boolean(process.env.OPENAI_API_KEY);
  const status = dbOk ? "healthy" : "degraded";
  try {
    const { getLogger } = await import('../../../_/logger.mjs');
    const log = getLogger();
    log.info("health_probe", { status, dbOk, openaiConfigured });
  } catch {
  }
  return {
    status,
    timestamp: now,
    uptimeSeconds: Math.round(uptime),
    services: {
      database: { ok: dbOk },
      openai: { configured: openaiConfigured }
    },
    env: {
      nodeEnv: "production"
    }
  };
});

export { health_get as default };
//# sourceMappingURL=health.get.mjs.map
