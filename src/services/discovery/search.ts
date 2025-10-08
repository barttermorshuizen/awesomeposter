import {
  discoverySearchResponseSchema,
  type DiscoverySearchResponse,
} from '@awesomeposter/shared'

export type DiscoverySearchQueryParams = {
  clientId: string
  statuses?: string[]
  sourceIds?: string[]
  topics?: string[]
  dateFrom?: string | null
  dateTo?: string | null
  page?: number
  pageSize?: number
  searchTerm?: string
}

type SearchRequestInit = {
  signal?: AbortSignal
}

function appendCommaSeparated(params: URLSearchParams, key: string, values: string[] | readonly string[]) {
  const filtered = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
  if (filtered.length === 0) {
    return
  }
  params.set(key, filtered.join(','))
}

async function parseResponseBody(response: Response): Promise<any> {
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
    return ''
  }
}

function resolveErrorMessage(status: number, payload: unknown): string {
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
  return `Failed to load discovery results (HTTP ${status})`
}

export async function searchDiscoveryItems(
  params: DiscoverySearchQueryParams,
  init: SearchRequestInit = {},
): Promise<DiscoverySearchResponse> {
  const query = new URLSearchParams()
  query.set('clientId', params.clientId)

  if (params.statuses?.length) {
    appendCommaSeparated(query, 'status', params.statuses)
  }
  if (params.sourceIds?.length) {
    appendCommaSeparated(query, 'sources', params.sourceIds)
  }
  if (params.topics?.length) {
    appendCommaSeparated(query, 'topics', params.topics)
  }
  if (params.dateFrom) {
    query.set('dateFrom', params.dateFrom)
  }
  if (params.dateTo) {
    query.set('dateTo', params.dateTo)
  }
  if (typeof params.page === 'number' && params.page > 1) {
    query.set('page', String(params.page))
  } else {
    query.set('page', '1')
  }
  if (typeof params.pageSize === 'number') {
    query.set('pageSize', String(params.pageSize))
  }
  if (params.searchTerm) {
    query.set('searchTerm', params.searchTerm)
  }

  const response = await fetch(`/api/discovery/search?${query.toString()}`, {
    headers: {
      accept: 'application/json',
    },
    signal: init.signal,
  })

  const payload = await parseResponseBody(response)
  if (!response.ok) {
    throw new Error(resolveErrorMessage(response.status, payload))
  }

  const parsed = discoverySearchResponseSchema.safeParse(payload)
  if (!parsed.success) {
    throw new Error('Discovery search response was not in the expected format.')
  }
  return parsed.data
}
