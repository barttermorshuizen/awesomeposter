import {
  discoveryItemDetailSchema,
  discoveryPromoteItemInputSchema,
  type DiscoveryItemDetail,
} from '@awesomeposter/shared'

function resolveErrorMessage(status: number, payload: unknown, fallback: string): string {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const candidates = [
      record.statusMessage,
      record.message,
      record.error,
      (Array.isArray(record.issues) && record.issues.length > 0 && typeof record.issues[0]?.message === 'string'
        ? record.issues[0]?.message
        : null),
    ]
    const match = candidates.find((candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0)
    if (match) {
      return match
    }
  }
  if (typeof payload === 'string' && payload.length > 0) {
    return payload
  }
  return `${fallback} (HTTP ${status})`
}

async function readJson(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') ?? ''
  if (contentType.includes('application/json')) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }
  try {
    return await response.text()
  } catch {
    return null
  }
}

export async function fetchDiscoveryItemDetail(itemId: string): Promise<DiscoveryItemDetail> {
  const response = await fetch(`/api/discovery/items/${itemId}`, {
    headers: { accept: 'application/json' },
  })

  const payload = await readJson(response)
  if (!response.ok) {
    throw new Error(resolveErrorMessage(response.status, payload, 'Failed to load discovery item detail'))
  }

  const parsed = discoveryItemDetailSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Discovery item detail response was not in the expected format.')
  }

  return parsed.data
}

export async function promoteDiscoveryItem(itemId: string, note: string): Promise<DiscoveryItemDetail> {
  const payload = discoveryPromoteItemInputSchema.parse({ note })

  const response = await fetch(`/api/discovery/items/${itemId}/promote`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const body = await readJson(response)
  if (!response.ok) {
    throw new Error(resolveErrorMessage(response.status, body, 'Failed to promote discovery item'))
  }

  const parsed = discoveryItemDetailSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('Promotion response was not in the expected format.')
  }

  return parsed.data
}
