import {
  serializeDiscoverySourceConfig,
  type DiscoverySourceWebListConfig,
  type DiscoveryWebListPreviewResult,
} from '@awesomeposter/shared'
import type { DiscoverySourceApiRecord } from '@/stores/discoverySources'

export type UpdateWebListConfigPayload = {
  webList: DiscoverySourceWebListConfig | null
  suggestionId?: string | null
}

export type UpdateWebListConfigResponse = {
  ok: true
  source: DiscoverySourceApiRecord
  warnings?: string[]
  suggestionAcknowledged?: boolean
}

export async function updateDiscoverySourceWebListConfig(
  clientId: string,
  sourceId: string,
  payload: UpdateWebListConfigPayload,
): Promise<UpdateWebListConfigResponse> {
  const configPayload = payload.webList
    ? serializeDiscoverySourceConfig({ webList: payload.webList })
    : null
  const body: Record<string, unknown> = {
    webList: configPayload?.webList ?? null,
  }
  if (payload.suggestionId) {
    body.suggestionId = payload.suggestionId
  }

  const res = await fetch(`/api/clients/${clientId}/sources/${sourceId}`, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify(body),
  })

  const contentType = res.headers.get('content-type') ?? ''
  const payloadJson = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null)

  if (!res.ok) {
    const message = typeof payloadJson === 'object' && payloadJson
      ? (payloadJson as { statusMessage?: string; message?: string; error?: string }).statusMessage
        ?? (payloadJson as { message?: string; error?: string }).message
        ?? (payloadJson as { error?: string }).error
      : typeof payloadJson === 'string'
        ? payloadJson
        : `HTTP ${res.status}`
    throw new Error(message || 'Failed to update discovery source configuration')
  }

  const data = (payloadJson ?? {}) as UpdateWebListConfigResponse
  if (!data.ok || !data.source) {
    throw new Error('Unexpected response while updating discovery source configuration')
  }
  return data
}

export type CheckWebListConfigPayload = {
  webList: DiscoverySourceWebListConfig
}

export type CheckWebListConfigResponse = {
  ok: true
  result: DiscoveryWebListPreviewResult
}

export async function checkWebListConfig(
  clientId: string,
  sourceId: string,
  payload: CheckWebListConfigPayload,
): Promise<CheckWebListConfigResponse> {
  const body = serializeDiscoverySourceConfig({ webList: payload.webList })
  const res = await fetch(`/api/clients/${clientId}/sources/${sourceId}/web-list/preview`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      webList: body?.webList ?? null,
    }),
  })

  const contentType = res.headers.get('content-type') ?? ''
  const payloadJson = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => null)

  if (!res.ok) {
    const message = typeof payloadJson === 'object' && payloadJson
      ? (payloadJson as { statusMessage?: string; message?: string; error?: string }).statusMessage
        ?? (payloadJson as { message?: string; error?: string }).message
        ?? (payloadJson as { error?: string }).error
      : typeof payloadJson === 'string'
        ? payloadJson
        : `HTTP ${res.status}`
    throw new Error(message || 'Preview failed for discovery source configuration')
  }

  const data = (payloadJson ?? {}) as CheckWebListConfigResponse
  if (!data.ok || !data.result) {
    throw new Error('Unexpected response while previewing discovery source configuration')
  }
  return data
}
