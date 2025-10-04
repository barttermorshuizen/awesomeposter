import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../../nitro/nitro.mjs';
import { c as createDiscoveryKeyword, l as listDiscoveryKeywords, I as InvalidDiscoveryKeywordError, D as DuplicateDiscoveryKeywordError, K as KeywordLimitExceededError } from '../../../../_/discovery-repository.mjs';
import { e as emitDiscoveryEvent } from '../../../../_/discovery-events.mjs';
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

const index_post = defineEventHandler(async (event) => {
  var _a;
  const clientId = getRouterParam(event, "id");
  if (!clientId) {
    throw createError({ statusCode: 400, statusMessage: "clientId is required" });
  }
  const payload = await readBody(event);
  const keyword = typeof (payload == null ? void 0 : payload.keyword) === "string" ? payload.keyword : "";
  const addedBy = typeof (payload == null ? void 0 : payload.addedBy) === "string" ? payload.addedBy : void 0;
  try {
    const record = await createDiscoveryKeyword({ clientId, keyword, addedBy });
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
    return {
      ok: true,
      keyword: {
        ...record,
        addedBy: (_a = record.addedBy) != null ? _a : null,
        createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : record.createdAt,
        updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : record.updatedAt
      }
    };
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: "feature_disabled" } });
    }
    if (error instanceof InvalidDiscoveryKeywordError) {
      throw createError({ statusCode: 400, statusMessage: error.message });
    }
    if (error instanceof DuplicateDiscoveryKeywordError) {
      throw createError({ statusCode: 409, statusMessage: error.message });
    }
    if (error instanceof KeywordLimitExceededError) {
      throw createError({ statusCode: 422, statusMessage: error.message });
    }
    throw error;
  }
});

export { index_post as default };
//# sourceMappingURL=index.post.mjs.map
