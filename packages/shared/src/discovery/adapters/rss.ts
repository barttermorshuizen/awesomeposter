import type { DiscoveryIngestionAdapter, DiscoveryAdapterResult } from '../ingestion.js'
import { fetchHttpSource } from './http.js'

export const fetchRssSource: DiscoveryIngestionAdapter = async (input, context): Promise<DiscoveryAdapterResult> => {
  const result = await fetchHttpSource(input, context)
  if (result.ok) {
    return {
      ...result,
      metadata: {
        ...(result.metadata ?? {}),
        adapter: 'rss',
      },
    }
  }
  return {
    ...result,
    metadata: {
      ...(result.metadata ?? {}),
      adapter: 'rss',
    },
  }
}

export default fetchRssSource
