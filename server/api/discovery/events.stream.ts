import { getQuery, setHeader } from 'h3'
import { onDiscoveryEvent } from '../../utils/discovery-events'
import type { DiscoveryEventEnvelope } from '@awesomeposter/shared'
import {
  FEATURE_DISCOVERY_AGENT,
  requireDiscoveryFeatureEnabled,
  subscribeToFeatureFlagUpdates,
} from '../../utils/client-config/feature-flags'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  const clientIdFilter = typeof query.clientId === 'string' ? query.clientId : null

  if (!clientIdFilter) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required' })
  }

  try {
    await requireDiscoveryFeatureEnabled(clientIdFilter)
  } catch (error) {
    if (error instanceof Error) {
      throw createError({ statusCode: 403, statusMessage: error.message, data: { code: 'feature_disabled' } })
    }
    throw error
  }

  setHeader(event, 'Content-Type', 'text/event-stream')
  setHeader(event, 'Cache-Control', 'no-cache, no-transform')
  setHeader(event, 'Connection', 'keep-alive')

  const res = event.node.res
  res.flushHeaders?.()
  res.write(': connected\n\n')

  const send = (payload: DiscoveryEventEnvelope) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`)
  }

  const unsubscribe = onDiscoveryEvent((payload) => {
    if (payload.payload.clientId !== clientIdFilter) return
    send(payload)
  })

  const unsubscribeFlag = subscribeToFeatureFlagUpdates((payload) => {
    if (payload.feature !== FEATURE_DISCOVERY_AGENT) return
    if (payload.clientId !== clientIdFilter) return
    if (payload.enabled === false) {
      res.write('event: feature_disabled\n')
      res.write(`data: ${JSON.stringify({ reason: 'discovery-disabled' })}\n\n`)
      close()
    }
  })

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 15000)

  const close = () => {
    clearInterval(heartbeat)
    unsubscribe()
    unsubscribeFlag()
    res.end()
  }

  event.node.req.on('close', close)
  event.node.req.on('end', close)
})
