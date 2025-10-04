import { d as defineEventHandler, r as readBody } from '../../nitro/nitro.mjs';
import { r as requireDiscoveryFeatureEnabled, a as FeatureFlagDisabledError } from '../../_/feature-flags.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '@upstash/redis';
import '../../_/index.mjs';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';

const retrieveWinners_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { clientId, briefId, platform: _platform, limit = 5 } = body;
    if (!clientId || !briefId) {
      throw new Error("clientId and briefId are required");
    }
    await requireDiscoveryFeatureEnabled(clientId);
    const winners = [
      {
        id: "winner-1",
        content: "This is a winning post that performed well",
        platform: "linkedin",
        performance: { impressions: 1e3, engagement: 0.08 }
      },
      {
        id: "winner-2",
        content: "Another high-performing post with great insights",
        platform: "linkedin",
        performance: { impressions: 800, engagement: 0.12 }
      }
    ].slice(0, limit);
    return {
      success: true,
      winners
    };
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      event.node.res.statusCode = 403;
      return {
        success: false,
        error: error.message,
        code: "feature_disabled"
      };
    }
    console.error("Error retrieving winners:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
});

export { retrieveWinners_post as default };
//# sourceMappingURL=retrieve-winners.post.mjs.map
