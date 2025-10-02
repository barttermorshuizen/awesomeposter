export const FEATURE_DISCOVERY_AGENT = 'discovery-agent' as const

export type FeatureFlagName = typeof FEATURE_DISCOVERY_AGENT | (string & {})

export const FEATURE_FLAG_PUBSUB_TOPIC = 'feature.flags.updated' as const

export type FeatureFlagUpdatePayload = {
  clientId: string
  feature: FeatureFlagName
  enabled?: boolean
  updatedAt?: string
}
