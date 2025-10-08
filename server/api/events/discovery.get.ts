import { randomUUID } from 'node:crypto'
import { getQuery, setHeader, createError, defineEventHandler } from 'h3'
import { z } from 'zod'
import { subscribeToFeatureFlagUpdates, FEATURE_DISCOVERY_AGENT } from '../../utils/client-config/feature-flags'
import { onDiscoveryEvent } from '../../utils/discovery-events'
import { toDiscoveryTelemetryEvent } from '../../utils/discovery-telemetry'
import type { DiscoveryTelemetryEvent } from '@awesomeposter/shared'

const CONNECTION_LIMIT_PER_USER = 5
const HEARTBEAT_INTERVAL_MS = 30_000
const RETRY_DELAY_MS = 5_000

const querySchema = z.object({
  clientId: z.string().uuid(),
})

type ActiveConnection = {
  id: string
  userId: string
  clientId: string
  startedAt: number
}

const userConnections = new Map<string, Set<ActiveConnection>>()

function getConnectionSet(userId: string) {
  let set = userConnections.get(userId)
  if (!set) {
    set = new Set<ActiveConnection>()
    userConnections.set(userId, set)
  }
  return set
}

function ensureCapacity(connection: ActiveConnection) {
  const set = getConnectionSet(connection.userId)
  if (set.size >= CONNECTION_LIMIT_PER_USER) {
    console.warn(JSON.stringify({
      event: 'discovery.sse.rate_limited',
      userId: connection.userId,
      clientId: connection.clientId,
      attemptedAt: new Date().toISOString(),
      activeConnections: set.size,
    }))
    throw createError({ statusCode: 429, statusMessage: 'Too many concurrent SSE connections' })
  }
  return set
}

function registerConnection(connection: ActiveConnection) {
  const set = ensureCapacity(connection)
  set.add(connection)
  return set
}

function releaseConnection(connection: ActiveConnection) {
  const set = userConnections.get(connection.userId)
  if (!set) return
  set.delete(connection)
  if (set.size === 0) {
    userConnections.delete(connection.userId)
  }
}

function writeEvent(res: import('node:http').ServerResponse, event: DiscoveryTelemetryEvent) {
  res.write(`data: ${JSON.stringify(event)}\n\n`)
}

export default defineEventHandler(async (event) => {
  const sessionUser = { id: 'dev-user', clientIds: null as string[] | null }

  const rawQuery = getQuery(event)
  const parseResult = querySchema.safeParse(rawQuery)
  if (!parseResult.success) {
    throw createError({ statusCode: 400, statusMessage: 'clientId is required and must be a UUID' })
  }

  const clientId = parseResult.data.clientId

  const userId = sessionUser.id
  const connectionId = randomUUID()
  const startedAt = Date.now()

  const connection: ActiveConnection = {
    id: connectionId,
    clientId,
    userId,
    startedAt,
  }

  registerConnection(connection)

  const res = event.node.res
  let heartbeat: ReturnType<typeof setInterval> | null = null
  try {
    setHeader(event, 'Content-Type', 'text/event-stream; charset=utf-8')
    setHeader(event, 'Cache-Control', 'no-cache, no-transform')
    setHeader(event, 'Connection', 'keep-alive')
    res.write(`retry: ${RETRY_DELAY_MS}\n`)
    res.write(`: connected ${new Date().toISOString()}\n\n`)
    res.flushHeaders?.()
    ;(event as typeof event & { _handled?: boolean })._handled = true

    heartbeat = setInterval(() => {
      res.write(': heartbeat\n\n')
    }, HEARTBEAT_INTERVAL_MS)
  } catch (error) {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
    releaseConnection(connection)
    throw error
  }

  console.info(JSON.stringify({
    event: 'discovery.sse.connected',
    connectionId,
    clientId,
    userId,
    connectedAt: new Date(startedAt).toISOString(),
    activeConnections: getConnectionSet(userId).size,
  }))

  const sendTelemetry = (payload: DiscoveryTelemetryEvent) => {
    try {
      writeEvent(res, payload)
    } catch (error) {
      console.error('Failed to write discovery SSE event', { error })
    }
  }

  const unsubscribeEvents = onDiscoveryEvent((envelope) => {
    const telemetry = toDiscoveryTelemetryEvent(envelope)
    if (!telemetry) return
    if (telemetry.clientId !== clientId) return
    sendTelemetry(telemetry)
  })

  const unsubscribeFlags = subscribeToFeatureFlagUpdates((payload) => {
    if (payload.feature !== FEATURE_DISCOVERY_AGENT) return
    if (payload.clientId !== clientId) return
    if (payload.enabled === false) {
      res.write('event: feature_disabled\n')
      res.write(`data: ${JSON.stringify({ reason: 'discovery-disabled' })}\n\n`)
      cleanup()
    }
  })

  let closed = false

  function cleanup() {
    if (closed) return
    closed = true
    if (heartbeat) clearInterval(heartbeat)
    unsubscribeEvents()
    unsubscribeFlags()
    releaseConnection(connection)
    const durationMs = Date.now() - startedAt
    console.info(JSON.stringify({
      event: 'discovery.sse.disconnected',
      connectionId,
      clientId,
      userId,
      disconnectedAt: new Date().toISOString(),
      durationMs,
    }))
    try {
      res.end()
    } catch {}
  }

  event.node.req.on('close', cleanup)
  event.node.req.on('aborted', cleanup)
  event.node.req.on('end', cleanup)
  res.on('close', cleanup)
  res.on('error', cleanup)
})
