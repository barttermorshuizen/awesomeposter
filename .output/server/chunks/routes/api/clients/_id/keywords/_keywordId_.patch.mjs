import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../../../nitro/nitro.mjs';
import { u as updateDiscoveryKeyword, l as listDiscoveryKeywords, I as InvalidDiscoveryKeywordError, D as DuplicateDiscoveryKeywordError, a as DiscoveryKeywordNotFoundError } from '../../../../../_/discovery-repository.mjs';
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
import 'drizzle-orm';
import '../../../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'zod';
import '../../../../../_/discovery.mjs';
import '@upstash/redis';

const _keywordId__patch = defineEventHandler(async (event) => {
  var _a;
  const clientId = getRouterParam(event, "id");
  const keywordId = getRouterParam(event, "keywordId");
  if (!clientId || !keywordId) {
    throw createError({ statusCode: 400, statusMessage: "clientId and keywordId are required" });
  }
  const payload = await readBody(event);
  const keyword = typeof (payload == null ? void 0 : payload.keyword) === "string" ? payload.keyword : "";
  try {
    const record = await updateDiscoveryKeyword({ clientId, keywordId, keyword });
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
    if (error instanceof DiscoveryKeywordNotFoundError) {
      throw createError({ statusCode: 404, statusMessage: error.message });
    }
    throw error;
  }
});

export { _keywordId__patch as default };
//# sourceMappingURL=_keywordId_.patch.mjs.map
