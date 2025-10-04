import { d as defineEventHandler, a as getRouterParam, c as createError } from '../../../../../nitro/nitro.mjs';
import { d as deleteDiscoveryKeyword, l as listDiscoveryKeywords } from '../../../../../_/discovery-repository.mjs';
import { e as emitDiscoveryEvent } from '../../../../../_/discovery-events.mjs';
import { a as FeatureFlagDisabledError } from '../../../../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '../../../../../_/index.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';
import 'zod';
import '../../../../../_/discovery.mjs';
import '@upstash/redis';

const _keywordId__delete = defineEventHandler(async (event) => {
  const clientId = getRouterParam(event, "id");
  const keywordId = getRouterParam(event, "keywordId");
  if (!clientId || !keywordId) {
    throw createError({ statusCode: 400, statusMessage: "clientId and keywordId are required" });
  }
  try {
    const deletedId = await deleteDiscoveryKeyword({ clientId, keywordId });
    if (!deletedId) {
      throw createError({ statusCode: 404, statusMessage: "Keyword not found" });
    }
    const items = await listDiscoveryKeywords(clientId);
    emitDiscoveryEvent({
      type: "keyword.updated",
      version: 1,
      payload: {
        clientId,
        keywords: items.map((item) => item.keyword),
        updatedAt: (/* @__PURE__ */ new Date()).toISOString()
      }
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: "feature_disabled" } });
    }
    throw error;
  }
});

export { _keywordId__delete as default };
//# sourceMappingURL=_keywordId_.delete.mjs.map
