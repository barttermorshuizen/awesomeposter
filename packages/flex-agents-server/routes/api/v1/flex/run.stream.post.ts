import { TaskEnvelopeSchema } from '@awesomeposter/shared'
import { createSse } from '../../../../src/utils/sse'
import { withSseConcurrency, sseSemaphore, isBacklogFull, backlogSnapshot } from '../../../../src/utils/concurrency'
import { getHeader, setHeader, getMethod, sendNoContent, createError, readBody } from 'h3'
import { FlexRunCoordinator } from '../../../../src/services/flex-run-coordinator'
import { genCorrelationId, getLogger } from '../../../../src/services/logger'
import { FeatureFlagDisabledError, requireDiscoveryFeatureEnabled } from '../../../../src/utils/feature-flags'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'OPTIONS') {
    const origin = getHeader(event, 'origin')
    if (origin) {
      setHeader(event, 'Vary', 'Origin')
      setHeader(event, 'Access-Control-Allow-Origin', origin)
    }
    setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    setHeader(event, 'Access-Control-Allow-Headers', getHeader(event, 'access-control-request-headers') || 'content-type,accept,authorization,x-correlation-id')
    setHeader(event, 'Access-Control-Max-Age', 600)
    return sendNoContent(event, 204)
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'content-type,accept,authorization,x-correlation-id')
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')

  if (isBacklogFull()) {
    const snap = backlogSnapshot()
    try {
      getLogger().warn('flex_run_backlog_reject', snap)
    } catch {}
    setHeader(event, 'Retry-After', 2)
    setHeader(event, 'Cache-Control', 'no-store')
    setHeader(event, 'X-Backlog-Pending', String(snap.pending))
    setHeader(event, 'X-Backlog-Limit', String(snap.limit))
    throw createError({ statusCode: 503, statusMessage: 'Server busy. Please retry.' })
  }

  const body = (event as any).context?.body ?? (await readBody(event))
  const envelope = TaskEnvelopeSchema.parse(body)

  const correlationId = getHeader(event, 'x-correlation-id') || genCorrelationId()
  setHeader(event, 'x-correlation-id', correlationId)

  const rawClientId = envelope.metadata?.clientId
  const clientId = typeof rawClientId === 'string' ? rawClientId.trim() : ''
  if (!clientId) {
    try {
      getLogger().warn('flex_run_missing_client', { correlationId })
    } catch {}
    throw createError({
      statusCode: 400,
      statusMessage: 'Flex runs require metadata.clientId for feature gating'
    })
  }

  try {
    await requireDiscoveryFeatureEnabled(clientId)
  } catch (error) {
    if (error instanceof FeatureFlagDisabledError) {
      try {
        getLogger().warn('flex_run_feature_disabled', { clientId, correlationId })
      } catch {}
      throw createError({
        statusCode: error.statusCode ?? 403,
        statusMessage: error.message
      })
    }
    throw error
  }

  try {
    getLogger().info('flex_run_start', {
      correlationId,
      objective: envelope.objective?.slice(0, 120) ?? null
    })
  } catch {}

  const sse = createSse(event, { correlationId })

  try {
    if (sseSemaphore.pending > 0 || sseSemaphore.used > 0) {
      try {
        getLogger().info('flex_sse_queue', { used: sseSemaphore.used, pending: sseSemaphore.pending, correlationId })
      } catch {}
    }

    await withSseConcurrency(async () => {
      const coordinator = new FlexRunCoordinator()
      await coordinator.run(envelope, {
        correlationId,
        onEvent: async (frame) => {
          await sse.send(frame)
        }
      })
    })
  } catch (error: any) {
    const message = error?.statusMessage || error?.message || 'Unknown error'
    await sse.send({ type: 'log', message })
  } finally {
    sse.close()
  }
})
