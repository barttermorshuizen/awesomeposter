export const FEATURE_DISCOVERY_AGENT = 'discovery-agent' as const
export const FEATURE_DISCOVERY_FILTERS_V1 = 'discovery.filters.v1' as const

export type FeatureFlagName =
  | typeof FEATURE_DISCOVERY_AGENT
  | typeof FEATURE_DISCOVERY_FILTERS_V1
  | (string & {})

export const FEATURE_FLAG_PUBSUB_TOPIC = 'feature.flags.updated' as const

export const DISCOVERY_FLAG_CHANGED_EVENT = 'discovery.flagChanged' as const

export type FeatureFlagUpdatePayload = {
  clientId: string
  feature: FeatureFlagName
  enabled?: boolean
  updatedAt?: string
}

export type DiscoveryFlagChangedTelemetry = {
  event: typeof DISCOVERY_FLAG_CHANGED_EVENT
  clientId: string
  feature: typeof FEATURE_DISCOVERY_AGENT
  enabled: boolean
  actor: string
  previousEnabled: boolean
  occurredAt: string
  reason?: string | null
}
