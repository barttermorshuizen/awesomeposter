import { EventEmitter } from 'node:events'
import { Redis } from '@upstash/redis'
import { and, eq, getDb, clientFeatures } from '@awesomeposter/db'
import {
  FEATURE_DISCOVERY_AGENT,
  FEATURE_FLAG_PUBSUB_TOPIC,
  DISCOVERY_FLAG_CHANGED_EVENT,
  type FeatureFlagName,
  type FeatureFlagUpdatePayload,
  type DiscoveryFlagChangedTelemetry,
} from '@awesomeposter/shared'

const CACHE_TTL_MS = 2 * 60_000
const FAILSAFE_TTL_MS = 30_000
const CACHE_PREFIX = 'feature-flag'

const memoryCache = new Map<string, { value: boolean; expiresAt: number }>()
let redisClient: Redis | null | undefined

type FeatureFlagEmitterGlobal = typeof globalThis & {
  __awesomeposterFeatureFlagEmitter__?: EventEmitter
}

const globalScope = globalThis as FeatureFlagEmitterGlobal

if (!globalScope.__awesomeposterFeatureFlagEmitter__) {
  const emitter = new EventEmitter()
  emitter.setMaxListeners(100)
  globalScope.__awesomeposterFeatureFlagEmitter__ = emitter
}

const emitter = globalScope.__awesomeposterFeatureFlagEmitter__!

function getRedisClient(): Redis | null {
  if (redisClient !== undefined) return redisClient
  const url = process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.UPSTASH_REDIS_REST_TOKEN
  if (url && token) {
    try {
      redisClient = new Redis({ url, token })
    } catch (error) {
      console.error('Failed to initialise Redis client for feature flags', error)
      redisClient = null
    }
  } else {
    redisClient = null
  }
  return redisClient
}

function buildCacheKey(clientId: string, feature: FeatureFlagName) {
  return `${CACHE_PREFIX}:${clientId}:${feature}`
}

async function cacheGet(key: string) {
  const redis = getRedisClient()
  if (redis) {
    try {
      const raw = await redis.get<string | null>(key)
      if (raw === null || raw === undefined) return undefined
      return raw === '1'
    } catch (error) {
      console.error('Feature flag redis get failed', { error })
      return undefined
    }
  }
  const entry = memoryCache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    memoryCache.delete(key)
    return undefined
  }
  return entry.value
}

async function cacheSet(key: string, value: boolean, ttlMs: number) {
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.set(key, value ? '1' : '0', { ex: Math.ceil(ttlMs / 1000) })
      return
    } catch (error) {
      console.error('Feature flag redis set failed', { error })
    }
  }
  memoryCache.set(key, { value, expiresAt: Date.now() + ttlMs })
}

async function cacheDelete(key: string) {
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.del(key)
    } catch (error) {
      console.error('Feature flag redis delete failed', { error })
    }
  }
  memoryCache.delete(key)
}

async function queryFeatureEnabled(clientId: string, feature: FeatureFlagName) {
  const db = getDb()
  const rows = await db
    .select({ enabled: clientFeatures.enabled })
    .from(clientFeatures)
    .where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, feature)))
    .limit(1)
  return rows[0]?.enabled ?? false
}

function describeFeature(feature: FeatureFlagName) {
  if (feature === FEATURE_DISCOVERY_AGENT) {
    return 'Discovery agent'
  }
  return feature.replace(/[-_]/g, ' ')
}

export class FeatureFlagDisabledError extends Error {
  public readonly clientId: string
  public readonly feature: FeatureFlagName
  public readonly statusCode = 403

  constructor(clientId: string, feature: FeatureFlagName, message?: string) {
    super(message ?? `${describeFeature(feature)} is not enabled for this client.`)
    this.name = 'FeatureFlagDisabledError'
    this.clientId = clientId
    this.feature = feature
  }
}

export async function isFeatureEnabled(clientId: string, feature: FeatureFlagName) {
  const key = buildCacheKey(clientId, feature)
  const cached = await cacheGet(key)
  if (cached !== undefined) {
    return cached
  }

  try {
    const enabled = await queryFeatureEnabled(clientId, feature)
    await cacheSet(key, enabled, CACHE_TTL_MS)
    return enabled
  } catch (error) {
    console.error('Feature flag lookup failed', { clientId, feature, error })
    await cacheSet(key, false, FAILSAFE_TTL_MS)
    return false
  }
}

export async function requireFeatureEnabled(clientId: string, feature: FeatureFlagName, message?: string) {
  const enabled = await isFeatureEnabled(clientId, feature)
  if (!enabled) {
    throw new FeatureFlagDisabledError(clientId, feature, message)
  }
}

export async function requireDiscoveryFeatureEnabled(clientId: string) {
  await requireFeatureEnabled(clientId, FEATURE_DISCOVERY_AGENT, 'Discovery agent is not enabled for this client.')
}

export async function invalidateFeatureFlagCache(clientId: string, feature: FeatureFlagName) {
  const key = buildCacheKey(clientId, feature)
  await cacheDelete(key)
}

export async function publishFeatureFlagUpdate(payload: FeatureFlagUpdatePayload) {
  await invalidateFeatureFlagCache(payload.clientId, payload.feature)
  emitter.emit(FEATURE_FLAG_PUBSUB_TOPIC, payload)
  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.publish(FEATURE_FLAG_PUBSUB_TOPIC, JSON.stringify(payload))
    } catch (error) {
      console.error('Feature flag redis publish failed', { error })
    }
  }
}

export async function emitDiscoveryFlagChanged(payload: DiscoveryFlagChangedTelemetry) {
  emitter.emit(DISCOVERY_FLAG_CHANGED_EVENT, payload)

  const redis = getRedisClient()
  if (redis) {
    try {
      await redis.publish(DISCOVERY_FLAG_CHANGED_EVENT, JSON.stringify(payload))
    } catch (error) {
      console.error('Discovery flag telemetry publish failed', { error })
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
    reason: payload.reason ?? undefined,
  }

  console.info('[telemetry]', JSON.stringify(metadata))
}

export function subscribeToDiscoveryFlagChanges(listener: (payload: DiscoveryFlagChangedTelemetry) => void) {
  emitter.on(DISCOVERY_FLAG_CHANGED_EVENT, listener)
  return () => emitter.off(DISCOVERY_FLAG_CHANGED_EVENT, listener)
}

export function subscribeToFeatureFlagUpdates(listener: (payload: FeatureFlagUpdatePayload) => void) {
  emitter.on(FEATURE_FLAG_PUBSUB_TOPIC, listener)
  return () => emitter.off(FEATURE_FLAG_PUBSUB_TOPIC, listener)
}

export function flushLocalFeatureFlagCache() {
  memoryCache.clear()
}

subscribeToFeatureFlagUpdates(({ clientId, feature }) => {
  void invalidateFeatureFlagCache(clientId, feature)
})

export {
  FEATURE_DISCOVERY_AGENT,
  FEATURE_FLAG_PUBSUB_TOPIC,
  DISCOVERY_FLAG_CHANGED_EVENT,
}

export type { FeatureFlagUpdatePayload, FeatureFlagName, DiscoveryFlagChangedTelemetry }
