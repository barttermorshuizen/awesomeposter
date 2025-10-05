import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, toNodeListener, eventHandler } from 'h3'
import { PassThrough } from 'node:stream'
import { IncomingMessage, ServerResponse } from 'node:http'
import type { SessionUser } from '../../../server/utils/session'
import discoveryHandler from '../../../server/api/events/discovery.get'
import { emitDiscoveryEvent } from '../../../server/utils/discovery-events'

vi.mock('../../../server/utils/client-config/feature-flags', () => {
  type Listener = (payload: { feature: string; clientId: string; enabled: boolean }) => void
  const listeners = new Set<Listener>()
  return {
    FEATURE_DISCOVERY_AGENT: 'discovery-agent',
    requireDiscoveryFeatureEnabled: vi.fn().mockResolvedValue(undefined),
    subscribeToFeatureFlagUpdates: (listener: Listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    __triggerFlagUpdate: (payload: { feature: string; clientId: string; enabled: boolean }) => {
      listeners.forEach((listener) => listener(payload))
    },
  }
})

const { __triggerFlagUpdate } = await import('../../../server/utils/client-config/feature-flags') as {
  __triggerFlagUpdate: (payload: { feature: string; clientId: string; enabled: boolean }) => void
}

process.env.API_KEY = 'test-api-key'

type SseMessage =
  | { type: 'comment'; comment: string }
  | { type: string; data: string; retry?: number }

class SseTestClient {
  private socket: PassThrough
  private req: IncomingMessage
  private res: ServerResponse
  private buffer = ''
  private headerParsed = false
  private queue: string[] = []
  private resolvers: Array<(value: string | null) => void> = []
  private ended = false
  public statusCode: number | null = null
  public statusMessage: string | null = null
  public readonly ready: Promise<void>
  private readyResolver: (() => void) | null = null

  constructor(
    private handler: (req: IncomingMessage, res: ServerResponse) => void,
    path: string,
    headers: Record<string, string>
  ) {
    this.ready = new Promise((resolve) => {
      this.readyResolver = resolve
    })

    this.socket = new PassThrough()
    this.req = new IncomingMessage(this.socket as any)
    this.req.method = 'GET'
    this.req.url = path
    this.req.headers = Object.fromEntries(
      Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
    )
    this.res = new ServerResponse(this.req)
    this.res.assignSocket(this.socket as any)

    this.socket.on('data', (chunk) => this.onData(chunk.toString()))
    this.socket.on('end', () => this.onEnd())
    this.socket.on('close', () => this.onEnd())

    this.handler(this.req, this.res)
  }

  private onData(chunk: string) {
    this.buffer += chunk
    if (!this.headerParsed) {
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) return
      const rawHeader = this.buffer.slice(0, headerEnd)
      this.buffer = this.buffer.slice(headerEnd + 4)
      this.parseHeader(rawHeader)
      this.headerParsed = true
    }
    this.drain()
  }

  private parseHeader(raw: string) {
    const [statusLine, ...headerLines] = raw.split('\r\n')
    const parts = statusLine.split(' ')
    if (parts.length >= 3) {
      this.statusCode = Number.parseInt(parts[1], 10)
      this.statusMessage = parts.slice(2).join(' ')
    }
    for (const line of headerLines) {
      const idx = line.indexOf(':')
      if (idx === -1) continue
      const name = line.slice(0, idx).trim().toLowerCase()
      const value = line.slice(idx + 1).trim()
      if (name === 'retry') {
        this.queue.push(`retry:${value}`)
      }
    }
    if (this.readyResolver) {
      this.readyResolver()
      this.readyResolver = null
    }
  }

  private drain() {
    while (true) {
      const delimiter = this.buffer.indexOf('\n\n')
      if (delimiter === -1) break
      const block = this.buffer.slice(0, delimiter)
      this.buffer = this.buffer.slice(delimiter + 2)
      this.queue.push(block)
      this.resolveNext()
    }
  }

  private resolveNext() {
    if (this.queue.length === 0) return
    const resolver = this.resolvers.shift()
    if (resolver) resolver(this.queue.shift()!)
  }

  private onEnd() {
    if (this.ended) return
    this.ended = true
    const pending = this.resolvers
    this.resolvers = []
    pending.forEach((resolve) => resolve(null))
  }

  async nextBlock(): Promise<string | null> {
    if (this.queue.length > 0) {
      return this.queue.shift()!
    }
    if (this.ended) return null
    return new Promise((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  async nextEvent(): Promise<SseMessage | null> {
    while (true) {
      const block = await this.nextBlock()
      if (block === null) return null
      const parsed = parseSseBlock(block)
      if (parsed) return parsed
    }
  }

  close() {
    this.socket.end()
  }
}

function parseSseBlock(block: string): SseMessage | null {
  const lines = block.split('\n')
  let eventName: string | undefined
  let retry: number | undefined
  const dataLines: string[] = []
  const comments: string[] = []
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '')
    if (line.startsWith(':')) {
      comments.push(line.slice(1).trim())
      continue
    }
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim()
      continue
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim())
      continue
    }
    if (line.startsWith('retry:')) {
      const value = Number.parseInt(line.slice(6).trim(), 10)
      if (!Number.isNaN(value)) retry = value
    }
  }
  if (dataLines.length > 0) {
    return {
      type: eventName ?? 'message',
      data: dataLines.join('\n'),
      retry,
    }
  }
  if (comments.length > 0) {
    return { type: 'comment', comment: comments.join('\n') }
  }
  return null
}

describe('GET /api/events/discovery', () => {
  let handler: (req: IncomingMessage, res: ServerResponse) => void
  let currentUser: SessionUser | undefined
  let usingFakeTimers = false

  beforeAll(() => {
    const app = createApp()
    app.use(eventHandler((event) => {
      if (currentUser) {
        event.context.auth = { user: currentUser }
      } else {
        event.context.auth = undefined
      }
    }))
    app.use('/api/events/discovery', discoveryHandler)
    handler = toNodeListener(app)
  })

  beforeEach(() => {
    currentUser = undefined
  })

  afterEach(() => {
    currentUser = undefined
    if (usingFakeTimers) {
      vi.useRealTimers()
      usingFakeTimers = false
    }
  })

  function createClient(path: string, headers: Record<string, string>) {
    return new SseTestClient(handler, path, headers)
  }

  async function readNextData(client: SseTestClient) {
    while (true) {
      const frame = await client.nextEvent()
      if (!frame) return frame
      if (frame.type === 'comment') continue
      return frame
    }
  }

  async function readNextComment(client: SseTestClient) {
    while (true) {
      const frame = await client.nextEvent()
      if (!frame) return frame
      if (frame.type === 'comment') return frame
    }
  }

  it('requires bearer token', async () => {
    const client = createClient('/api/events/discovery?clientId=00000000-0000-0000-0000-000000000123', {
      accept: 'text/event-stream',
    })
    await client.ready
    expect(client.statusCode).toBe(401)
    client.close()
  })

  it('requires authenticated session', async () => {
    const client = createClient('/api/events/discovery?clientId=00000000-0000-0000-0000-000000000123', {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(401)
    client.close()
  })

  it('rejects access to unauthorized client', async () => {
    currentUser = { id: 'user-x', clientIds: ['00000000-0000-0000-0000-000000000999'] }
    const client = createClient('/api/events/discovery?clientId=00000000-0000-0000-0000-000000000123', {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(403)
    client.close()
  })

  it('streams discovery events scoped to client', async () => {
    const clientId = '00000000-0000-0000-0000-000000000123'
    currentUser = { id: 'user-stream', clientIds: [clientId] }
    const client = createClient(`/api/events/discovery?clientId=${clientId}`, {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(200)
    await readNextComment(client)

    emitDiscoveryEvent({
      type: 'source-created',
      version: 1,
      payload: {
        id: '00000000-0000-0000-0000-00000000AAAA',
        clientId,
        url: 'https://example.com',
        canonicalUrl: 'https://example.com',
        sourceType: 'rss',
        identifier: 'example',
        createdAt: new Date().toISOString(),
      },
    })

    const event = await readNextData(client)
    expect(event).toBeTruthy()
    const payload = JSON.parse((event as SseMessage).data) as Record<string, unknown>
    expect(payload).toMatchObject({
      schemaVersion: 1,
      eventType: 'source-created',
      clientId,
      entityId: '00000000-0000-0000-0000-00000000AAAA',
    })

    client.close()
  })

  it('streams ingestion.failed telemetry envelope', async () => {
    const clientId = '00000000-0000-0000-0000-000000000777'
    currentUser = { id: 'user-failure', clientIds: [clientId] }
    const client = createClient(`/api/events/discovery?clientId=${clientId}`, {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(200)
    await readNextComment(client)

    const nextRetryAt = new Date('2025-04-01T10:05:00Z').toISOString()
    emitDiscoveryEvent({
      type: 'ingestion.failed',
      version: 1,
      payload: {
        runId: 'run-failure',
        clientId,
        sourceId: '00000000-0000-0000-0000-00000000BBBB',
        sourceType: 'rss',
        failureReason: 'network_error',
        attempt: 3,
        maxAttempts: 3,
        retryInMinutes: 4,
        nextRetryAt,
      },
    })

    const frame = await readNextData(client)
    expect(frame).toBeTruthy()
    const payload = JSON.parse((frame as SseMessage).data) as Record<string, unknown>
    expect(payload).toMatchObject({
      eventType: 'ingestion.failed',
      clientId,
      entityId: '00000000-0000-0000-0000-00000000BBBB',
      payload: expect.objectContaining({
        failureReason: 'network_error',
        attempt: 3,
        maxAttempts: 3,
        retryInMinutes: 4,
        nextRetryAt,
      }),
    })

    client.close()
  })

  it('streams source.health telemetry envelope', async () => {
    const clientId = '00000000-0000-0000-0000-000000000888'
    currentUser = { id: 'user-health', clientIds: [clientId] }
    const client = createClient(`/api/events/discovery?clientId=${clientId}`, {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(200)
    await readNextComment(client)

    const observedAt = new Date('2025-04-02T08:15:00Z').toISOString()
    emitDiscoveryEvent({
      type: 'source.health',
      version: 1,
      payload: {
        clientId,
        sourceId: '00000000-0000-0000-0000-00000000CCCC',
        sourceType: 'rss',
        status: 'error',
        lastFetchedAt: observedAt,
        failureReason: 'http_4xx',
        observedAt,
        attempt: 1,
      },
    })

    const frame = await readNextData(client)
    expect(frame).toBeTruthy()
    const payload = JSON.parse((frame as SseMessage).data) as Record<string, unknown>
    expect(payload).toMatchObject({
      eventType: 'source.health',
      clientId,
      entityId: '00000000-0000-0000-0000-00000000CCCC',
      payload: expect.objectContaining({
        status: 'error',
        failureReason: 'http_4xx',
        observedAt,
      }),
    })

    client.close()
  })

  it('emits heartbeat comment every 30 seconds', async () => {
    vi.useFakeTimers()
    usingFakeTimers = true
    const clientId = '00000000-0000-0000-0000-000000000123'
    currentUser = { id: 'user-heartbeat', clientIds: [clientId] }
    const client = createClient(`/api/events/discovery?clientId=${clientId}`, {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(200)
    await readNextComment(client)

    await vi.advanceTimersByTimeAsync(30_000)
    const heartbeat = await readNextComment(client)
    expect(heartbeat).toEqual({ type: 'comment', comment: 'heartbeat' })

    client.close()
  })

  it('enforces per-user connection cap', async () => {
    const clientId = '00000000-0000-0000-0000-000000000123'
    currentUser = { id: 'user-limit', clientIds: [clientId] }
    const clients: SseTestClient[] = []
    for (let i = 0; i < 5; i++) {
      const client = createClient(`/api/events/discovery?clientId=${clientId}`, {
        accept: 'text/event-stream',
        authorization: 'Bearer test-api-key',
      })
      await client.ready
      expect(client.statusCode).toBe(200)
      clients.push(client)
    }

    const overflow = createClient(`/api/events/discovery?clientId=${clientId}`, {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await overflow.ready
    expect(overflow.statusCode).toBe(429)
    overflow.close()
    clients.forEach((c) => c.close())
  })

  it('propagates feature_disabled event via SSE', async () => {
    const clientId = '00000000-0000-0000-0000-000000000123'
    currentUser = { id: 'user-feature', clientIds: [clientId] }
    const client = createClient(`/api/events/discovery?clientId=${clientId}`, {
      accept: 'text/event-stream',
      authorization: 'Bearer test-api-key',
    })
    await client.ready
    expect(client.statusCode).toBe(200)
    await readNextComment(client)

    __triggerFlagUpdate({ feature: 'discovery-agent', clientId, enabled: false })

    const frame = await readNextData(client)
    expect(frame?.type).toBe('feature_disabled')
    expect(JSON.parse((frame as SseMessage).data)).toEqual({ reason: 'discovery-disabled' })

    client.close()
  })
})
