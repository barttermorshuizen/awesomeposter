import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { createApp, toNodeListener } from 'h3'
import { PassThrough } from 'node:stream'
import { IncomingMessage, ServerResponse } from 'node:http'

const discoveryEventMocks = vi.hoisted(() => ({
  emitDiscoveryEvent: vi.fn(),
}))

vi.mock('@awesomeposter/shared', async () => {
  const actual = await vi.importActual('../../../packages/shared/dist/index.js')
  return actual
})

vi.mock('../../../server/utils/discovery-events', () => ({
  emitDiscoveryEvent: discoveryEventMocks.emitDiscoveryEvent,
}))

vi.mock('../../../server/utils/discovery-repository', async () => {
  const actual = await vi.importActual<typeof import('../../../server/utils/discovery-repository')>(
    '../../../server/utils/discovery-repository'
  )
  return {
    ...actual,
    searchDiscoveryItems: vi.fn(),
  }
})

import searchHandler from '../../../server/api/discovery/search.get'
import {
  searchDiscoveryItems,
  __discoverySearchInternals,
} from '../../../server/utils/discovery-repository'

const searchDiscoveryItemsMock = searchDiscoveryItems as unknown as Mock
const { emitDiscoveryEvent } = discoveryEventMocks

let handler: (req: IncomingMessage, res: ServerResponse) => void
const CLIENT_ID = '00000000-0000-0000-0000-000000000111'

beforeAll(async () => {
  const app = createApp()
  app.use('/api/discovery/search', searchHandler)
  handler = toNodeListener(app)
})

beforeEach(() => {
  searchDiscoveryItemsMock.mockReset()
  emitDiscoveryEvent.mockClear()
})

async function request(path: string, headers: Record<string, string> = {}) {
  const socket = new PassThrough()
  const req = new IncomingMessage(socket as any)
  req.url = path
  req.method = 'GET'
  req.headers = Object.fromEntries(
    Object.entries({
      accept: 'application/json',
      ...headers,
    }).map(([key, value]) => [key.toLowerCase(), value]),
  )
  const res = new ServerResponse(req)
  res.assignSocket(socket as any)
  const chunks: Buffer[] = []

  const originalWrite = res.write.bind(res)
  res.write = (chunk, ...rest) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return originalWrite(chunk, ...rest)
  }

  const originalEnd = res.end.bind(res)
  res.end = (chunk, ...rest) => {
    if (chunk) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    return originalEnd(chunk, ...rest)
  }

  const finished = new Promise<void>((resolve, reject) => {
    res.on('finish', () => resolve())
    res.on('error', reject)
  })

  req.push(null)
  const maybePromise = handler(req, res)
  if (maybePromise && typeof maybePromise.then === 'function') {
    await maybePromise
  }
  await finished

  const bodyText = Buffer.concat(chunks).toString('utf8')
  let json: any = null
  if (bodyText) {
    try {
      json = JSON.parse(bodyText)
    } catch {
      json = bodyText
    }
  }
  return {
    status: res.statusCode ?? 0,
    body: json,
  }
}

describe('GET /api/discovery/search', () => {
  it('returns 400 when required params are missing', async () => {
    const { status, body } = await request('/api/discovery/search')
    expect(status).toBe(400)
    expect(body).toMatchObject({
      data: {
        issues: expect.any(Array),
      },
    })
    expect(searchDiscoveryItemsMock).not.toHaveBeenCalled()
  })

  it('returns search results and emits telemetry', async () => {
    searchDiscoveryItemsMock.mockResolvedValue({
      items: [
        {
          id: '11111111-1111-1111-1111-111111111111',
          title: 'Example Item',
          url: 'https://example.com/item',
          status: 'spotted',
          score: 0.87,
          sourceId: '22222222-2222-2222-2222-222222222222',
          fetchedAt: new Date('2025-04-05T10:00:00Z').toISOString(),
          publishedAt: new Date('2025-04-04T08:00:00Z').toISOString(),
          ingestedAt: new Date('2025-04-05T10:05:00Z').toISOString(),
          summary: 'Summary text',
          topics: ['ai', 'marketing'],
          highlights: [
            { field: 'title', snippets: ['<mark>Example</mark> Item'] },
          ],
        },
      ],
      total: 1,
    })

    const query = new URLSearchParams({
      clientId: CLIENT_ID,
      status: 'spotted,approved',
      sources: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      page: '2',
      pageSize: '50',
      searchTerm: 'example',
    })

    const { status, body } = await request(`/api/discovery/search?${query.toString()}`)

    expect(status).toBe(200)
    expect(body).toMatchObject({
      total: 1,
      page: 2,
      pageSize: 50,
      latencyMs: expect.any(Number),
      items: expect.arrayContaining([
        expect.objectContaining({
          id: '11111111-1111-1111-1111-111111111111',
          highlights: [
            expect.objectContaining({
              field: 'title',
              snippets: ['<mark>Example</mark> Item'],
            }),
          ],
        }),
      ]),
    })
    expect(searchDiscoveryItemsMock).toHaveBeenCalledWith(expect.objectContaining({
      clientId: CLIENT_ID,
      statuses: ['spotted', 'approved'],
      sourceIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'],
      page: 2,
      pageSize: 50,
      searchTerm: 'example',
    }))

    expect(emitDiscoveryEvent).toHaveBeenCalledTimes(2)
    const completionEvent = emitDiscoveryEvent.mock.calls[1]![0] as Record<string, any>
    expect(completionEvent).toMatchObject({
      type: 'discovery.search.completed',
      payload: expect.objectContaining({
        degraded: false,
        total: 1,
        returned: 1,
        page: 2,
        pageSize: 50,
        statuses: ['spotted', 'approved'],
      }),
    })
  })

  it('marks response as degraded when total surpasses threshold', async () => {
    searchDiscoveryItemsMock.mockResolvedValue({
      items: [],
      total: 1205,
    })

    const { status } = await request('/api/discovery/search?clientId=00000000-0000-0000-0000-000000000111')
    expect(status).toBe(200)

    expect(emitDiscoveryEvent).toHaveBeenCalledTimes(2)
    const completionEvent = emitDiscoveryEvent.mock.calls[1]![0] as Record<string, any>
    expect(completionEvent.payload.degraded).toBe(true)
    expect(completionEvent.payload.degradeReason).toBe('results')
  })
})

describe('discovery search helpers', () => {
  const { sanitizeHeadline, buildHighlight, summarize } = __discoverySearchInternals

  it('sanitizes headline snippets and preserves highlight markup', () => {
    const snippets = sanitizeHeadline('__MARK__Match__END__ <script>alert(1)</script>')
    expect(snippets).toEqual(['<mark>Match</mark> &lt;script&gt;alert(1)&lt;/script&gt;'])
  })

  it('builds highlight payload only when snippets exist', () => {
    const highlight = buildHighlight('title', '__MARK__Focus__END__ result')
    expect(highlight).toEqual({
      field: 'title',
      snippets: ['<mark>Focus</mark> result'],
    })
    expect(buildHighlight('title', '')).toBeNull()
  })

  it('summarises text with ellipsis when exceeding limit', () => {
    const summary = summarize('A'.repeat(400), 50)
    expect(summary?.endsWith('...')).toBe(true)
    expect(summary?.length).toBeLessThanOrEqual(53)
  })
})
