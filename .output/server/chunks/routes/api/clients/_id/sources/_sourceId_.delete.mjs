import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../../nitro/nitro.mjs';
import { b as deleteDiscoverySource } from '../../../../../_/discovery-repository.mjs';
import { b as FeatureFlagDisabledError } from '../../../../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm';
import '../../../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'zod';
import '../../../../../_/discovery.mjs';
import '@upstash/redis';

const _sourceId__delete = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  const sourceId = getRouterParam(event, "sourceId");
  if (!clientId || !sourceId) {
    throw createError({ statusCode: 400, statusMessage: "clientId and sourceId are required" });
  }
  try {
    const deletedId = await deleteDiscoverySource({ clientId, sourceId });
    if (!deletedId) {
      throw createError({ statusCode: 404, statusMessage: "Source not found" });
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: "feature_disabled" } });
    }
    throw error;
  }
});

export { _sourceId__delete as default };
//# sourceMappingURL=_sourceId_.delete.mjs.map
