import type { DiscoveryIngestionAdapter, DiscoveryAdapterResult } from '../ingestion.js'
import type { DiscoveryIngestionFailureReason } from '../../discovery.js'

type Fetcher = typeof globalThis.fetch

type FetchError = Error & { name?: string }

function resolveFailureReason(responseStatus: number): DiscoveryIngestionFailureReason {
  if (responseStatus >= 500) return 'http_5xx'
  if (responseStatus >= 400) return 'http_4xx'
  return 'unknown_error'
}

async function readResponseBody(response: Response) {
  try {
    const cloned = response.clone()
    return await cloned.text()
  } catch (error) {
    return { error: (error as Error).message }
  }
}

export const fetchHttpSource: DiscoveryIngestionAdapter = async (input, context): Promise<DiscoveryAdapterResult> => {
  const fetcher: Fetcher | undefined = context?.fetch ?? globalThis.fetch
  if (!fetcher) {
    return {
      ok: false,
      failureReason: 'unknown_error',
      error: new Error('No fetch implementation available for HTTP adapter'),
    }
  }

  try {
    const response = await fetcher(input.url, { signal: context?.signal })

    if (!response.ok) {
      const failureReason = resolveFailureReason(response.status)
      const raw = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        body: await readResponseBody(response),
      }
      return {
        ok: false,
        failureReason,
        raw,
        retryInMinutes: failureReason === 'http_5xx' ? 5 : null,
        metadata: {
          adapter: 'http',
          status: response.status,
        },
      }
    }

    const body = await response.text()
    return {
      ok: true,
      items: [],
      raw: {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
      },
      metadata: {
        adapter: 'http',
        contentLength: body.length,
      },
    }
  } catch (error) {
    const err = error as FetchError
    const failureReason: DiscoveryIngestionFailureReason = err.name === 'AbortError' ? 'timeout' : 'network_error'
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === 'network_error' ? 5 : null,
      metadata: {
        adapter: 'http',
        message: err.message,
      },
    }
  }
}

export default fetchHttpSource
