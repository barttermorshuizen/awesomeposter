import type { DiscoveryIngestionAdapter, DiscoveryAdapterResult } from '../ingestion.js'
import type { DiscoveryIngestionFailureReason } from '../../discovery.js'
import { fetchHttpSource } from './http.js'

function mapYoutubeFailureReason(result: DiscoveryAdapterResult): DiscoveryAdapterResult {
  if (result.ok) {
    return {
      ...result,
      metadata: {
        ...(result.metadata ?? {}),
        adapter: 'youtube',
      },
    }
  }

  let failureReason: DiscoveryIngestionFailureReason = result.failureReason
  const status = typeof result.metadata?.status === 'number' ? result.metadata.status : null
  if (status === 403 || status === 429) {
    failureReason = 'youtube_quota'
  } else if (status === 404) {
    failureReason = 'youtube_not_found'
  }

  return {
    ...result,
    failureReason,
    metadata: {
      ...(result.metadata ?? {}),
      adapter: 'youtube',
    },
  }
}

export const fetchYoutubeSource: DiscoveryIngestionAdapter = async (input, context) => {
  const result = await fetchHttpSource(input, context)
  const normalized = result.ok
    ? result
    : {
        ...result,
        metadata: {
          ...(result.metadata ?? {}),
          status:
            result.metadata?.status
            ?? (typeof (result.raw as { status?: number } | undefined)?.status === 'number'
              ? (result.raw as { status?: number }).status
              : undefined),
        },
      }
  return mapYoutubeFailureReason(normalized)
}

export default fetchYoutubeSource
