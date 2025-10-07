import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import { i as isFeatureEnabled, F as FEATURE_DISCOVERY_AGENT, a as FEATURE_DISCOVERY_FILTERS_V1 } from '../../../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '@upstash/redis';
import 'drizzle-orm';
import '../../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';

const featureFlags_get = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required" });
  }
  try {
    const [discoveryAgentEnabled, discoveryFiltersEnabled] = await Promise.all([
      isFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT),
      isFeatureEnabled(clientId, FEATURE_DISCOVERY_FILTERS_V1)
    ]);
    return {
      ok: true,
      flags: {
        discoveryAgent: discoveryAgentEnabled,
        discoveryFiltersV1: discoveryFiltersEnabled
      }
    };
  } catch (error) {
    throw createError({ statusCode: 500, statusMessage: "Failed to load feature flags", data: { error: String(error) } });
  }
});

export { featureFlags_get as default };
//# sourceMappingURL=feature-flags.get.mjs.map
