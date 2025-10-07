import crypto from 'node:crypto'
import {
  and,
  eq,
  getDb,
  clients,
  clientFeatures,
  clientFeatureToggleAudits,
} from '@awesomeposter/db'
import {
  FEATURE_DISCOVERY_AGENT,
  FEATURE_DISCOVERY_FILTERS_V1,
  DISCOVERY_FLAG_CHANGED_EVENT,
  type FeatureFlagName,
} from '@awesomeposter/shared'
import {
  publishFeatureFlagUpdate,
  emitDiscoveryFlagChanged,
} from './feature-flags'

export class FeatureFlagAdminError extends Error {
  public readonly statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'FeatureFlagAdminError'
    this.statusCode = statusCode
  }
}

export class ClientNotFoundError extends FeatureFlagAdminError {
  public readonly clientId: string

  constructor(clientId: string) {
    super(`Client ${clientId} not found`, 404)
    this.name = 'ClientNotFoundError'
    this.clientId = clientId
  }
}

export const SUPPORTED_CLIENT_FEATURES = [
  FEATURE_DISCOVERY_AGENT,
  FEATURE_DISCOVERY_FILTERS_V1,
] as const

export type SupportedClientFeature = typeof SUPPORTED_CLIENT_FEATURES[number]

export type DiscoveryFlagToggleInput = {
  clientId: string
  enable: boolean
  actor: string
  reason?: string | null
}

export type ClientFeatureToggleInput = {
  clientId: string
  feature: FeatureFlagName
  enable: boolean
  actor: string
  reason?: string | null
}

export type DiscoveryFlagToggleResult = ClientFeatureToggleResult

export type ClientFeatureToggleResult = {
  changed: boolean
  previousEnabled: boolean
  newEnabled: boolean
  occurredAt: Date
  client: {
    id: string
    name: string
    slug: string | null
  }
}

export function isSupportedClientFeature(feature: FeatureFlagName): feature is SupportedClientFeature {
  return SUPPORTED_CLIENT_FEATURES.includes(feature as SupportedClientFeature)
}

export async function setClientFeatureFlag({
  clientId,
  feature,
  enable,
  actor,
  reason,
}: ClientFeatureToggleInput): Promise<ClientFeatureToggleResult> {
  const trimmedActor = actor?.trim()
  if (!trimmedActor) {
    throw new FeatureFlagAdminError('Actor is required', 400)
  }

  if (!isSupportedClientFeature(feature)) {
    throw new FeatureFlagAdminError(`Feature ${feature} is not supported for client toggles`, 400)
  }

  const trimmedReason = reason?.trim() || null
  const db = getDb()

  const result = await db.transaction(async (tx) => {
    const [client] = await tx
      .select({ id: clients.id, name: clients.name, slug: clients.slug })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1)

    if (!client) {
      throw new ClientNotFoundError(clientId)
    }

    const [existingFeature] = await tx
      .select({ enabled: clientFeatures.enabled })
      .from(clientFeatures)
      .where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, feature)))
      .limit(1)

    const currentEnabled = existingFeature?.enabled ?? false

    if (currentEnabled === enable) {
      return {
        changed: false,
        previousEnabled: currentEnabled,
        newEnabled: currentEnabled,
        occurredAt: new Date(),
        client,
      }
    }

    const timestamp = new Date()

    if (existingFeature) {
      await tx
        .update(clientFeatures)
        .set({ enabled: enable, updatedAt: timestamp })
        .where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, feature)))
    } else {
      await tx.insert(clientFeatures).values({
        clientId,
        feature,
        enabled: enable,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    await tx.insert(clientFeatureToggleAudits).values({
      id: crypto.randomUUID(),
      clientId,
      feature,
      previousEnabled: currentEnabled,
      newEnabled: enable,
      actor: trimmedActor,
      reason: trimmedReason,
      createdAt: timestamp,
    })

    return {
      changed: true,
      previousEnabled: currentEnabled,
      newEnabled: enable,
      occurredAt: timestamp,
      client,
    }
  })

  if (result.changed) {
    const occurredAtIso = result.occurredAt.toISOString()

    if (feature === FEATURE_DISCOVERY_AGENT) {
      await emitDiscoveryFlagChanged({
        event: DISCOVERY_FLAG_CHANGED_EVENT,
        clientId,
        feature: FEATURE_DISCOVERY_AGENT,
        enabled: result.newEnabled,
        previousEnabled: result.previousEnabled,
        actor: trimmedActor,
        reason: trimmedReason,
        occurredAt: occurredAtIso,
      })
    }

    await publishFeatureFlagUpdate({
      clientId,
      feature,
      enabled: result.newEnabled,
      updatedAt: occurredAtIso,
    })
  }

  return result
}

export async function setDiscoveryFlag(input: DiscoveryFlagToggleInput): Promise<DiscoveryFlagToggleResult> {
  return setClientFeatureFlag({ ...input, feature: FEATURE_DISCOVERY_AGENT })
}
