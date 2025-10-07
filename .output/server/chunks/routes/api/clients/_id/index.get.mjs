import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../nitro/nitro.mjs';
import { l as listDiscoveryKeywords } from '../../../../_/discovery-repository.mjs';
import { b as FeatureFlagDisabledError } from '../../../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm';
import '../../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'zod';
import '../../../../_/discovery.mjs';
import '@upstash/redis';

const index_get = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required" });
  }
  try {
    const items = await listDiscoveryKeywords(clientId);
    return {
      ok: true,
      items: items.map((item) => {
        var _a;
        return {
          ...item,
          addedBy: (_a = item.addedBy) != null ? _a : null,
          createdAt: item.createdAt instanceof Date ? item.createdAt.toISOString() : item.createdAt,
          updatedAt: item.updatedAt instanceof Date ? item.updatedAt.toISOString() : item.updatedAt
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
//# sourceMappingURL=index.get.mjs.map
