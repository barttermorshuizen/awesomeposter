export type ClientFeatureFlags = {
  discoveryAgent: boolean
  discoveryFiltersV1: boolean
}

type RawFeatureFlagsResponse = {
  flags?: Record<string, unknown>
}

function toBoolean(value: unknown): boolean {
  return value === true
}

export function parseClientFeatureFlags(payload: unknown): ClientFeatureFlags {
  const data = (payload as RawFeatureFlagsResponse | undefined)?.flags ?? {}
  return {
    discoveryAgent: toBoolean(data?.discoveryAgent),
    discoveryFiltersV1: toBoolean(data?.discoveryFiltersV1),
  }
}

export async function fetchClientFeatureFlags(clientId: string): Promise<ClientFeatureFlags> {
  const res = await fetch(`/api/clients/${clientId}/feature-flags`, {
    headers: { accept: 'application/json' },
  })

  const contentType = res.headers.get('content-type') || ''
  let payload: unknown = null

  if (contentType.includes('application/json')) {
    payload = await res.json().catch(() => null)
  } else {
    payload = await res.text().catch(() => '')
  }

  if (!res.ok) {
    const message = typeof payload === 'string'
      ? (payload || `HTTP ${res.status}`)
      : ((payload as any)?.statusMessage || (payload as any)?.message || (payload as any)?.error || `HTTP ${res.status}`)
    throw new Error(message)
  }

  return parseClientFeatureFlags(payload)
}
