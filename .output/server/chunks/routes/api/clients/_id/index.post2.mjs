import { d as defineEventHandler, a as getRouterParam, c as createError, r as readBody } from '../../../../nitro/nitro.mjs';
import { f as createDiscoverySource, g as InvalidDiscoverySourceError, h as DuplicateDiscoverySourceError } from '../../../../_/discovery-repository.mjs';
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
import 'drizzle-orm';
import '../../../../_/client.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
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
  const url = typeof (payload == null ? void 0 : payload.url) === "string" ? payload.url : "";
  const notes = typeof (payload == null ? void 0 : payload.notes) === "string" ? payload.notes : void 0;
  try {
    const record = await createDiscoverySource({
      clientId,
      url,
      notes
    });
    emitDiscoveryEvent({
      type: "source-created",
      version: 1,
      payload: {
        id: record.id,
        clientId: record.clientId,
        url: record.url,
        canonicalUrl: record.canonicalUrl,
        sourceType: record.sourceType,
        identifier: record.identifier,
        createdAt: record.createdAt.toISOString()
      }
    });
    return {
      ok: true,
      source: {
        ...record,
        notes: (_a = record.notes) != null ? _a : null
      }
    };
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: "feature_disabled" } });
    }
    if (error instanceof InvalidDiscoverySourceError) {
      throw createError({ statusCode: 400, statusMessage: error.message });
    }
    if (error instanceof DuplicateDiscoverySourceError) {
      throw createError({ statusCode: 409, statusMessage: error.message });
    }
    throw error;
  }
});

export { index_post as default };
//# sourceMappingURL=index.post2.mjs.map
