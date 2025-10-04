import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import { e as listDiscoverySources } from '../../../../_/discovery-repository.mjs';
import { a as FeatureFlagDisabledError } from '../../../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../../../../_/index.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';
import 'zod';
import '../../../../_/discovery.mjs';
import '@upstash/redis';

const index_get = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required" });
  }
  try {
    const items = await listDiscoverySources(clientId);
    return {
      ok: true,
      items: items.map((item) => {
        var _a;
        return {
          ...item,
          notes: (_a = item.notes) != null ? _a : null
        };
      })
    };
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: "feature_disabled" } });
    }
    throw error;
  }
});

export { index_get as default };
//# sourceMappingURL=index.get2.mjs.map
