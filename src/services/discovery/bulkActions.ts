import {
  discoveryBulkActionRequestSchema,
  discoveryBulkActionResponseSchema,
  type DiscoveryBulkActionRequest,
  type DiscoveryBulkActionResponse,
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
    const match = candidates.find((entry): entry is string => typeof entry === 'string' && entry.length > 0)
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

async function postBulkAction(endpoint: string, request: DiscoveryBulkActionRequest): Promise<DiscoveryBulkActionResponse> {
  const payload = discoveryBulkActionRequestSchema.parse(request)
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  const body = await readJson(response)
  if (!response.ok) {
    throw new Error(resolveErrorMessage(response.status, body, 'Bulk action request failed'))
  }

  const parsed = discoveryBulkActionResponseSchema.safeParse(body)
  if (!parsed.success) {
    throw new Error('Bulk action response was not in the expected format.')
  }
  return parsed.data
}

export function bulkPromote(request: DiscoveryBulkActionRequest) {
  return postBulkAction('/api/discovery/bulk/promote', request)
}

export function bulkArchive(request: DiscoveryBulkActionRequest) {
  return postBulkAction('/api/discovery/bulk/archive', request)
}
