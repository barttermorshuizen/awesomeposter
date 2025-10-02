import { getQuery, setHeader } from 'h3'
import { onDiscoveryEvent } from '../../utils/discovery-events'
import type { DiscoveryEventEnvelope } from '@awesomeposter/shared'

export default defineEventHandler((event) => {
  const query = getQuery(event)
  const clientIdFilter = typeof query.clientId === 'string' ? query.clientId : null

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
    if (clientIdFilter && payload.payload.clientId !== clientIdFilter) return
    send(payload)
  })

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n')
  }, 15000)

  const close = () => {
    clearInterval(heartbeat)
    unsubscribe()
    res.end()
  }

  event.node.req.on('close', close)
  event.node.req.on('end', close)
})
