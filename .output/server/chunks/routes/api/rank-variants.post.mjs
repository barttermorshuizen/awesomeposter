import { d as defineEventHandler, r as readBody } from '../../nitro/nitro.mjs';
import { r as requireDiscoveryFeatureEnabled, a as FeatureFlagDisabledError } from '../../_/feature-flags.mjs';
import { g as getDb, j as discoveryKeywords } from '../../_/index.mjs';
import { o as onDiscoveryEvent } from '../../_/discovery-events.mjs';
import { eq } from 'drizzle-orm';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '@upstash/redis';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';

const keywordCache = /* @__PURE__ */ new Map();
let subscribed = false;
function ensureSubscription() {
  if (subscribed) return;
  onDiscoveryEvent((event) => {
    if (event.type === "keyword.updated") {
      handleKeywordEvent(event);
    }
  });
  subscribed = true;
}
function handleKeywordEvent(event) {
  keywordCache.delete(event.payload.clientId);
}
async function getKeywordThemesForClient(clientId) {
  ensureSubscription();
  const cached = keywordCache.get(clientId);
  if (cached) {
    return cached.keywords;
  }
  const db = getDb();
  const rows = await db.select({ keyword: discoveryKeywords.keyword }).from(discoveryKeywords).where(eq(discoveryKeywords.clientId, clientId)).orderBy(discoveryKeywords.keyword);
  const keywords = rows.map((row) => row.keyword);
  keywordCache.set(clientId, { keywords, timestamp: Date.now() });
  return keywords;
}

const KEYWORD_BONUS_PER_MATCH = 0.1;
const MAX_KEYWORD_BONUS = 0.4;
const LONG_CONTENT_THRESHOLD = 120;
const LONG_CONTENT_SCORE = 0.6;
const SHORT_CONTENT_SCORE = 0.4;
function normalizeContent(content) {
  return content.toLowerCase();
}
function toBonus(matchCount) {
  return Math.min(MAX_KEYWORD_BONUS, matchCount * KEYWORD_BONUS_PER_MATCH);
}
async function scoreDiscoveryVariants(clientId, variants) {
  if (!variants.length) return [];
  const keywords = await getKeywordThemesForClient(clientId);
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());
  const scored = variants.map((variant) => {
    const content = normalizeContent(variant.content);
    const matchCount = normalizedKeywords.reduce((count, keyword) => {
      if (!keyword) return count;
      return content.includes(keyword) ? count + 1 : count;
    }, 0);
    const keywordBonus = toBonus(matchCount);
    const baseScore = variant.content.length > LONG_CONTENT_THRESHOLD ? LONG_CONTENT_SCORE : SHORT_CONTENT_SCORE;
    const totalScore = Math.min(1, parseFloat((baseScore + keywordBonus).toFixed(3)));
    return {
      ...variant,
      score: totalScore
    };
  });
  return scored.sort((a, b) => {
    var _a, _b;
    return ((_a = b.score) != null ? _a : 0) - ((_b = a.score) != null ? _b : 0);
  });
}

const rankVariants_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { clientId, briefId, variants } = body;
    if (!clientId || !briefId || !variants || variants.length === 0) {
      throw new Error("clientId, briefId and variants are required");
    }
    await requireDiscoveryFeatureEnabled(clientId);
    const rankedVariants = await scoreDiscoveryVariants(clientId, variants);
    return {
      success: true,
      rankedVariants
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
    console.error("Error ranking variants:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
});

export { rankVariants_post as default };
//# sourceMappingURL=rank-variants.post.mjs.map
