import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import { i as isFeatureEnabled, F as FEATURE_DISCOVERY_AGENT } from '../../../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '@upstash/redis';
import '../../../../_/index.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';

const featureFlags_get = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required" });
  }
  try {
    const enabled = await isFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT);
    return {
      ok: true,
      flags: {
        discoveryAgent: enabled
      }
    };
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: "Failed to load feature flags", data: { error: String(error) } });
  }
});

export { featureFlags_get as default };
//# sourceMappingURL=feature-flags.get.mjs.map
