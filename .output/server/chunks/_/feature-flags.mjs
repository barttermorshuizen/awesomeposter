import { EventEmitter } from 'node:events';
import { Redis } from '@upstash/redis';
import { g as getDb, d as clientFeatures } from './index.mjs';
import { and, eq } from 'drizzle-orm';

const FEATURE_DISCOVERY_AGENT = "discovery-agent";
const FEATURE_FLAG_PUBSUB_TOPIC = "feature.flags.updated";
const DISCOVERY_FLAG_CHANGED_EVENT = "discovery.flagChanged";

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
const CACHE_TTL_MS = 2 * 6e4;
const FAILSAFE_TTL_MS = 3e4;
const CACHE_PREFIX = "feature-flag";
const memoryCache = /* @__PURE__ */ new Map();
let redisClient;
const globalScope = globalThis;
if (!globalScope.__awesomeposterFeatureFlagEmitter__) {
  const emitter2 = new EventEmitter();
  emitter2.setMaxListeners(100);
  globalScope.__awesomeposterFeatureFlagEmitter__ = emitter2;
}
const emitter = globalScope.__awesomeposterFeatureFlagEmitter__;
function getRedisClient() {
  if (redisClient !== void 0) return redisClient;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (url && token) {
    try {
      redisClient = new Redis({ url, token });
    } catch (error) {
      console.error("Failed to initialise Redis client for feature flags", error);
      redisClient = null;
    }
  } else {
    redisClient = null;
  }
  return redisClient;
}
function buildCacheKey(clientId, feature) {
  return `${CACHE_PREFIX}:${clientId}:${feature}`;
}
async function cacheGet(key) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const raw = await redis.get(key);
      if (raw === null || raw === void 0) return void 0;
      return raw === "1";
    } catch (error) {
      console.error("Feature flag redis get failed", { error });
      return void 0;
    }
  }
  const entry = memoryCache.get(key);
  if (!entry) return void 0;
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key);
    return void 0;
  }
  return entry.value;
}
async function cacheSet(key, value, ttlMs) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(key, value ? "1" : "0", { ex: Math.ceil(ttlMs / 1e3) });
      return;
    } catch (error) {
      console.error("Feature flag redis set failed", { error });
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}
async function cacheDelete(key) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.del(key);
    } catch (error) {
      console.error("Feature flag redis delete failed", { error });
    }
  }
  memoryCache.delete(key);
}
async function queryFeatureEnabled(clientId, feature) {
  var _a, _b;
  const db = getDb();
  const rows = await db.select({ enabled: clientFeatures.enabled }).from(clientFeatures).where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, feature))).limit(1);
  return (_b = (_a = rows[0]) == null ? void 0 : _a.enabled) != null ? _b : false;
}
function describeFeature(feature) {
  if (feature === FEATURE_DISCOVERY_AGENT) {
    return "Discovery agent";
  }
  return feature.replace(/[-_]/g, " ");
}
class FeatureFlagDisabledError extends Error {
  constructor(clientId, feature, message) {
    super(message != null ? message : `${describeFeature(feature)} is not enabled for this client.`);
    __publicField(this, "clientId");
    __publicField(this, "feature");
    __publicField(this, "statusCode", 403);
    this.name = "FeatureFlagDisabledError";
    this.clientId = clientId;
    this.feature = feature;
  }
}
async function isFeatureEnabled(clientId, feature) {
  const key = buildCacheKey(clientId, feature);
  const cached = await cacheGet(key);
  if (cached !== void 0) {
    return cached;
  }
  try {
    const enabled = await queryFeatureEnabled(clientId, feature);
    await cacheSet(key, enabled, CACHE_TTL_MS);
    return enabled;
  } catch (error) {
    console.error("Feature flag lookup failed", { clientId, feature, error });
    await cacheSet(key, false, FAILSAFE_TTL_MS);
    return false;
  }
}
async function requireFeatureEnabled(clientId, feature, message) {
  const enabled = await isFeatureEnabled(clientId, feature);
  if (!enabled) {
    throw new FeatureFlagDisabledError(clientId, feature, message);
  }
}
async function requireDiscoveryFeatureEnabled(clientId) {
  await requireFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT, "Discovery agent is not enabled for this client.");
}
async function invalidateFeatureFlagCache(clientId, feature) {
  const key = buildCacheKey(clientId, feature);
  await cacheDelete(key);
}
async function publishFeatureFlagUpdate(payload) {
  await invalidateFeatureFlagCache(payload.clientId, payload.feature);
  emitter.emit(FEATURE_FLAG_PUBSUB_TOPIC, payload);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.publish(FEATURE_FLAG_PUBSUB_TOPIC, JSON.stringify(payload));
    } catch (error) {
      console.error("Feature flag redis publish failed", { error });
    }
  }
}
async function emitDiscoveryFlagChanged(payload) {
  var _a;
  emitter.emit(DISCOVERY_FLAG_CHANGED_EVENT, payload);
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.publish(DISCOVERY_FLAG_CHANGED_EVENT, JSON.stringify(payload));
    } catch (error) {
      console.error("Discovery flag telemetry publish failed", { error });
    }
  }
  const metadata = {
    event: payload.event,
    clientId: payload.clientId,
    feature: payload.feature,
    enabled: payload.enabled,
    actor: payload.actor,
    previousEnabled: payload.previousEnabled,
    occurredAt: payload.occurredAt,
    reason: (_a = payload.reason) != null ? _a : void 0
  };
  console.info("[telemetry]", JSON.stringify(metadata));
}
function subscribeToFeatureFlagUpdates(listener) {
  emitter.on(FEATURE_FLAG_PUBSUB_TOPIC, listener);
  return () => emitter.off(FEATURE_FLAG_PUBSUB_TOPIC, listener);
}
subscribeToFeatureFlagUpdates(({ clientId, feature }) => {
  void invalidateFeatureFlagCache(clientId, feature);
});

export { DISCOVERY_FLAG_CHANGED_EVENT as D, FEATURE_DISCOVERY_AGENT as F, FeatureFlagDisabledError as a, emitDiscoveryFlagChanged as e, isFeatureEnabled as i, publishFeatureFlagUpdate as p, requireDiscoveryFeatureEnabled as r, subscribeToFeatureFlagUpdates as s };
//# sourceMappingURL=feature-flags.mjs.map
