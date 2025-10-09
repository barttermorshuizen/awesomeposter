import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../utils/discovery-repository', () => ({
  listDiscoverySourcesDue: vi.fn(),
  claimDiscoverySourceForFetch: vi.fn(),
  completeDiscoverySourceFetch: vi.fn(),
  releaseDiscoverySourceAfterFailedCompletion: vi.fn(),
  saveDiscoveryItems: vi.fn(),
  persistDiscoveryScores: vi.fn(),
  resetDiscoveryItemsToPending: vi.fn(),
  countPendingDiscoveryItemsForClient: vi.fn(),
}))

vi.mock('../../utils/client-config/feature-flags', () => ({
  isFeatureEnabled: vi.fn(),
}))

vi.mock('../../utils/discovery/scoring', () => ({
  scoreDiscoveryItems: vi.fn(),
}))

vi.mock('@awesomeposter/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@awesomeposter/shared')>()
  return {
    ...actual,
    executeIngestionAdapter: vi.fn(),
  }
})

vi.mock('../../utils/discovery-events', () => ({
  emitDiscoveryEvent: vi.fn(),
}))

vi.mock('../../utils/discovery-health', () => ({
  publishSourceHealthStatus: vi.fn(),
}))

vi.mock('nitropack/runtime', () => ({
  defineTask: (input: unknown) => input,
}))

import {
  executeIngestionAdapter,
  getIngestionAdapter,
  type DiscoveryAdapterResult,
} from '@awesomeposter/shared'
import { runDiscoveryIngestionJob } from '../discovery/ingest-sources'
import type { PersistDiscoveryItemsResult } from '@awesomeposter/db'
import {
  listDiscoverySourcesDue,
  claimDiscoverySourceForFetch,
  completeDiscoverySourceFetch,
  releaseDiscoverySourceAfterFailedCompletion,
  saveDiscoveryItems,
  persistDiscoveryScores,
  resetDiscoveryItemsToPending,
  countPendingDiscoveryItemsForClient,
  type DiscoverySourceHealthUpdate,
  type SaveDiscoveryItemsInput,
  type CompleteDiscoverySourceFetchInput,
} from '../../utils/discovery-repository'
import { emitDiscoveryEvent } from '../../utils/discovery-events'
import { publishSourceHealthStatus } from '../../utils/discovery-health'
import { isFeatureEnabled } from '../../utils/client-config/feature-flags'
import { scoreDiscoveryItems } from '../../utils/discovery/scoring'

describe('runDiscoveryIngestionJob', () => {
  const now = new Date('2025-04-01T10:00:00Z')
  const defaultScoringConfig = {
    weights: { keyword: 0.5, recency: 0.3, source: 0.2 },
    threshold: 0.6,
    recencyHalfLifeHours: 48,
    weightsVersion: 1,
  }

  const baseSource = {
    id: 'source-1',
    clientId: 'client-1',
    url: 'https://example.com',
    canonicalUrl: 'https://example.com',
    sourceType: 'web-page' as const,
    identifier: 'example',
    notes: null,
    configJson: null,
    fetchIntervalMinutes: 60,
    nextFetchAt: new Date(now.getTime() - 60_000).toISOString(),
    lastFetchStatus: 'idle' as const,
    lastFetchStartedAt: null,
    lastFetchCompletedAt: null,
    lastFailureReason: null,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }

  const buildSource = (overrides: Partial<typeof baseSource> = {}) => ({
    ...baseSource,
    ...overrides,
  })

  const createHealth = (overrides: Partial<DiscoverySourceHealthUpdate> = {}): DiscoverySourceHealthUpdate => ({
    status: 'healthy',
    observedAt: new Date(now),
    lastFetchedAt: new Date(now),
    consecutiveFailures: 0,
    lastSuccessAt: new Date(now),
    ...overrides,
  })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.resetAllMocks()
    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(null)
    vi.mocked(completeDiscoverySourceFetch).mockResolvedValue(createHealth())
    vi.mocked(releaseDiscoverySourceAfterFailedCompletion).mockResolvedValue(createHealth({ status: 'warning' }))
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: true,
      items: [],
      metadata: { adapter: 'http' },
    } satisfies DiscoveryAdapterResult)
    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [], duplicates: [] })
    vi.mocked(persistDiscoveryScores).mockResolvedValue()
    vi.mocked(resetDiscoveryItemsToPending).mockResolvedValue()
    vi.mocked(countPendingDiscoveryItemsForClient).mockResolvedValue(0)
    vi.mocked(isFeatureEnabled).mockResolvedValue(true)
    vi.mocked(scoreDiscoveryItems).mockResolvedValue({
      ok: true,
      results: [],
      config: defaultScoringConfig,
    })
    vi.mocked(publishSourceHealthStatus).mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('handles string cadence timestamps without crashing and emits telemetry', async () => {
    const source = buildSource()

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockImplementation(async (id) => (id === source.id ? source : null))

    const result = await runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 2 })

    expect(result).toEqual({ totalDue: 1, processed: 1, succeeded: 1, failed: 0, skipped: 0 })
    const started = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'ingestion.started')?.[0]
    expect(started?.payload.scheduledAt).toBe(new Date(source.nextFetchAt).toISOString())
    expect(completeDiscoverySourceFetch).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: source.id,
      clientId: source.clientId,
      success: true,
    }))
    expect(saveDiscoveryItems).toHaveBeenCalledWith({
      clientId: source.clientId,
      sourceId: source.id,
      items: [],
    })
    const metrics = vi.mocked(completeDiscoverySourceFetch).mock.calls[0][0].metrics as Record<string, unknown>
    expect(metrics).toMatchObject({
      normalizedCount: 0,
      insertedCount: 0,
      duplicateCount: 0,
      webListConfigured: false,
      webListApplied: false,
    })
    expect(publishSourceHealthStatus).toHaveBeenCalledWith(expect.objectContaining({
      clientId: source.clientId,
      sourceId: source.id,
      status: 'healthy',
      consecutiveFailures: 0,
    }))
  })

  it('records webList telemetry when configuration is present', async () => {
    const source = buildSource({
      configJson: {
        webList: {
          list_container_selector: '.articles',
          item_selector: '.article',
          fields: {
            title: '.title',
            url: { selector: 'a', attribute: 'href' },
          },
          pagination: {
            next_page: { selector: '.next', attribute: 'href' },
            max_depth: 4,
          },
        },
      },
    })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(executeIngestionAdapter).mockImplementation(async (input) => {
      expect(input.config?.webList?.listContainerSelector).toBe('.articles')
      expect(input.config?.webList?.pagination?.maxDepth).toBe(4)
      return {
        ok: true,
        items: [],
        metadata: {
          adapter: 'http',
          webListApplied: true,
          listItemCount: 5,
          paginationDepth: 3,
        },
      }
    })

    await runDiscoveryIngestionJob({ now: () => new Date(now) })

    const metrics = vi.mocked(completeDiscoverySourceFetch).mock.calls[0][0].metrics as Record<string, unknown>
    expect(metrics).toMatchObject({
      webListConfigured: true,
      webListApplied: true,
      listItemCount: 5,
      paginationDepth: 3,
    })
  })

  it('processes HTTP list extraction end-to-end and records telemetry counts', async () => {
    const html = `
      <html>
        <body>
          <section class="feed">
            <article class="entry">
              <h2><a class="link" href="/launch">Launch Update</a></h2>
              <time class="time" data-published="2025-03-01T08:00:00Z"></time>
            </article>
            <article class="entry">
              <h2><a class="link" href="/metrics">Metrics Deep Dive</a></h2>
              <time class="time" data-published="2025-03-02T09:00:00Z"></time>
            </article>
            <article class="entry">
              <h2><a class="link" href="/retro">Retrospective Notes</a></h2>
              <time class="time" data-published="1710000000"></time>
            </article>
          </section>
        </body>
      </html>
    `

    const fetchMock = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(html))
    const source = buildSource({
      configJson: {
        webList: {
          list_container_selector: '.feed',
          item_selector: '.entry',
          fields: {
            title: { selector: '.link' },
            url: { selector: '.link', attribute: 'href' },
            timestamp: { selector: '.time', attribute: 'data-published' },
          },
        },
      },
    })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(saveDiscoveryItems).mockImplementation(async ({ items }: SaveDiscoveryItemsInput) => {
      const inserted: PersistDiscoveryItemsResult['inserted'] = items.map((_, idx) => ({
        id: `item-${idx}`,
        rawHash: `hash-${idx}`,
      }))
      return {
        inserted,
        duplicates: [],
      }
    })

    const httpAdapter = getIngestionAdapter('web-page')

    vi.mocked(executeIngestionAdapter).mockImplementation((input, adapterContext) =>
      httpAdapter(input, {
        ...adapterContext,
        fetch: fetchMock,
        now: () => now,
      }),
    )

    await runDiscoveryIngestionJob({ now: () => new Date(now), fetch: fetchMock })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(saveDiscoveryItems).toHaveBeenCalledWith(expect.objectContaining({
      items: expect.arrayContaining([
        expect.objectContaining({
          normalized: expect.objectContaining({
            url: 'https://example.com/launch',
          }),
        }),
      ]),
    }))
    const saveCalls = vi.mocked(saveDiscoveryItems).mock.calls
    const saveArgs = saveCalls[0]?.[0] as SaveDiscoveryItemsInput | undefined
    expect(saveArgs).toBeDefined()
    if (saveArgs) {
      expect(saveArgs.items).toHaveLength(3)
    }

    const fetchCalls = vi.mocked(completeDiscoverySourceFetch).mock.calls
    const fetchArgs = fetchCalls[0]?.[0] as CompleteDiscoverySourceFetchInput | undefined
    expect(fetchArgs).toBeDefined()
    if (fetchArgs) {
      expect(fetchArgs.metrics).toMatchObject({
        webListConfigured: true,
        webListApplied: true,
        listItemCount: 3,
      })
    }

    const completionCall = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'ingestion.completed')
    expect(completionCall).toBeDefined()
    if (completionCall) {
      const [completionEvent] = completionCall
      expect(completionEvent.payload?.metrics).toMatchObject({
        webListApplied: true,
        listItemCount: 3,
      })
    }
  })

  it('captures configuration validation issues when parsing fails', async () => {
    const source = buildSource({
      configJson: {
        webList: {
          list_container_selector: '.list',
        },
      },
    })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(executeIngestionAdapter).mockImplementation(async (input) => {
      expect(input.config).toBeNull()
      return {
        ok: true,
        items: [],
        metadata: { adapter: 'http' },
      }
    })

    await runDiscoveryIngestionJob({ now: () => new Date(now) })

    const metrics = vi.mocked(completeDiscoverySourceFetch).mock.calls[0][0].metrics as Record<string, unknown>
    expect(metrics).toMatchObject({
      webListConfigured: false,
      webListApplied: false,
    })
    expect(metrics.configValidationIssues).toEqual(expect.arrayContaining([
      expect.stringContaining('item_selector'),
    ]))
  })

  it('scores newly inserted items inline when conditions allow', async () => {
    const source = buildSource()
    const normalized = {
      externalId: 'ext-inline-1',
      title: 'Inline Score',
      url: 'https://example.com/inline',
      contentType: 'article' as const,
      publishedAt: now.toISOString(),
      publishedAtSource: 'original' as const,
      fetchedAt: now.toISOString(),
      extractedBody: 'Body text',
      excerpt: 'Body text',
    }
    const insertedId = 'item-inline-1'

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: true,
      items: [
        {
          rawPayload: { body: '<p>Inline</p>' },
          normalized,
          sourceMetadata: { contentType: 'article' },
        },
      ],
      metadata: { adapter: 'http' },
    })
    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [{ id: insertedId, rawHash: 'hash-inline' }], duplicates: [] })
    vi.mocked(countPendingDiscoveryItemsForClient)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0)
    vi.mocked(scoreDiscoveryItems).mockResolvedValue({
      ok: true,
      results: [
        {
          itemId: insertedId,
          clientId: source.clientId,
          sourceId: source.id,
          score: 0.92,
          components: { keyword: 0.95, recency: 0.9, source: 0.85 },
          appliedThreshold: 0.6,
          status: 'scored',
          weightsVersion: 1,
          matchedKeywords: ['marketing'],
        },
      ],
      config: defaultScoringConfig,
    })

    const result = await runDiscoveryIngestionJob({ now: () => new Date(now) })

    expect(result.succeeded).toBe(1)
    expect(scoreDiscoveryItems).toHaveBeenCalledWith([insertedId], { now: expect.any(Function) })
    expect(persistDiscoveryScores).toHaveBeenCalledWith([
      expect.objectContaining({
        itemId: insertedId,
        score: 0.92,
        status: 'scored',
        metadata: expect.objectContaining({ topics: ['marketing'] }),
      }),
    ])
    expect(emitDiscoveryEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'discovery.score.complete' }))
    expect(emitDiscoveryEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'discovery.queue.updated' }))
  })

  it('skips inline scoring when the feature flag is disabled', async () => {
    const source = buildSource()
    const insertedId = 'item-flagged'

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [{ id: insertedId, rawHash: 'hash-flagged' }], duplicates: [] })
    vi.mocked(isFeatureEnabled).mockResolvedValue(false)

    await runDiscoveryIngestionJob({ now: () => new Date(now) })

    expect(isFeatureEnabled).toHaveBeenCalled()
    expect(countPendingDiscoveryItemsForClient).not.toHaveBeenCalled()
    expect(scoreDiscoveryItems).not.toHaveBeenCalled()
    expect(persistDiscoveryScores).not.toHaveBeenCalled()
  })

  it('defers inline scoring when backlog exceeds threshold', async () => {
    const source = buildSource()
    const insertedId = 'item-backlog'

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [{ id: insertedId, rawHash: 'hash-backlog' }], duplicates: [] })
    vi.mocked(countPendingDiscoveryItemsForClient).mockResolvedValue(505)

    await runDiscoveryIngestionJob({ now: () => new Date(now) })

    expect(scoreDiscoveryItems).not.toHaveBeenCalled()
    expect(persistDiscoveryScores).not.toHaveBeenCalled()
    const backlogEvent = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'discovery.queue.updated')?.[0]
    expect(backlogEvent?.payload.reason).toBe('backlog')
  })

  it('emits scoring failure and resets items when scoring returns an error', async () => {
    const source = buildSource()
    const insertedId = 'item-error'

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [{ id: insertedId, rawHash: 'hash-error' }], duplicates: [] })
    vi.mocked(countPendingDiscoveryItemsForClient).mockResolvedValueOnce(1)
    vi.mocked(scoreDiscoveryItems).mockResolvedValue({
      ok: false,
      error: {
        code: 'DISCOVERY_SCORING_INVALID_ITEM',
        message: 'invalid',
        details: { itemIds: [insertedId] },
      },
    })

    await runDiscoveryIngestionJob({ now: () => new Date(now) })

    expect(resetDiscoveryItemsToPending).toHaveBeenCalledWith([insertedId])
    expect(persistDiscoveryScores).not.toHaveBeenCalled()
    const failureEvent = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'discovery.scoring.failed')?.[0]
    expect(failureEvent?.payload.itemIds).toContain(insertedId)
  })

  it('queues sources beyond worker limit and processes sequentially', async () => {
    const sources = [
      buildSource({ id: 'source-1' }),
      buildSource({ id: 'source-2', identifier: 'example-2', url: 'https://example.com/2', canonicalUrl: 'https://example.com/2' }),
      buildSource({ id: 'source-3', identifier: 'example-3', url: 'https://example.com/3', canonicalUrl: 'https://example.com/3' }),
    ]

    const deferred = new Map<string, { resolve: (value: DiscoveryAdapterResult) => void; promise: Promise<DiscoveryAdapterResult>; started: boolean }>()

    function createDeferred(id: string) {
      let resolve!: (value: DiscoveryAdapterResult) => void
      const promise = new Promise<DiscoveryAdapterResult>((res) => {
        resolve = res
      })
      deferred.set(id, { resolve, promise, started: false })
      return deferred.get(id)!
    }

    sources.forEach((source) => createDeferred(source.id))

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue(sources)
    vi.mocked(claimDiscoverySourceForFetch).mockImplementation(async (id) => sources.find((item) => item.id === id) ?? null)
    vi.mocked(executeIngestionAdapter).mockImplementation(async ({ sourceId }) => {
      const entry = deferred.get(sourceId)!
      entry.started = true
      return entry.promise
    })

    const jobPromise = runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    await vi.waitFor(() => {
      expect(deferred.get('source-1')?.started).toBe(true)
      expect(deferred.get('source-2')?.started).toBe(false)
    })

    deferred.get('source-1')?.resolve({ ok: true, items: [], metadata: { adapter: 'http' } })
    await vi.waitFor(() => {
      expect(deferred.get('source-2')?.started).toBe(true)
      expect(deferred.get('source-3')?.started).toBe(false)
    })

    deferred.get('source-2')?.resolve({ ok: true, items: [], metadata: { adapter: 'http' } })
    await vi.waitFor(() => {
      expect(deferred.get('source-3')?.started).toBe(true)
    })

    deferred.get('source-3')?.resolve({ ok: true, items: [], metadata: { adapter: 'http' } })

    const result = await jobPromise

    expect(result.succeeded).toBe(3)
    expect(executeIngestionAdapter).toHaveBeenCalledTimes(3)
    expect(completeDiscoverySourceFetch).toHaveBeenCalledTimes(3)
  })

  it('records failure and retry telemetry when adapter returns recoverable error', async () => {
    const source = buildSource({
      id: 'source-retry',
      clientId: 'client-retry',
      fetchIntervalMinutes: 30,
      nextFetchAt: new Date(now.getTime() - 120_000).toISOString(),
      sourceType: 'rss',
      canonicalUrl: 'https://rss.example.com/feed.xml',
      url: 'https://rss.example.com/feed.xml',
      identifier: 'rss-id',
    })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(completeDiscoverySourceFetch).mockResolvedValue(createHealth({
      status: 'error',
      consecutiveFailures: 3,
      failureReason: 'network_error',
      lastSuccessAt: null,
    }))
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: false,
      failureReason: 'network_error',
      retryInMinutes: 1,
      metadata: { adapter: 'rss' },
      error: new Error('network'),
    })

    const jobPromise = runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(120_000)

    const result = await jobPromise

    expect(result.failed).toBe(1)
    expect(executeIngestionAdapter).toHaveBeenCalledTimes(3)
    expect(completeDiscoverySourceFetch).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      failureReason: 'network_error',
      retryInMinutes: 4,
      telemetry: expect.objectContaining({
        durationMs: expect.any(Number),
        adapter: 'rss',
        attemptCount: 3,
        attempts: expect.arrayContaining([
          expect.objectContaining({ attempt: 1, success: false }),
          expect.objectContaining({ attempt: 2, success: false }),
          expect.objectContaining({ attempt: 3, success: false }),
        ]),
      }),
    }))
    expect(saveDiscoveryItems).not.toHaveBeenCalled()

    const completionEvent = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'ingestion.completed')?.[0]
    expect(completionEvent?.payload.failureReason).toBe('network_error')
    expect(completionEvent?.payload.retryInMinutes).toBe(4)
    expect(completionEvent?.payload.attempt).toBe(3)
    expect(completionEvent?.payload.maxAttempts).toBeGreaterThanOrEqual(3)

    const failureEvent = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'ingestion.failed')?.[0]
    expect(failureEvent?.payload).toMatchObject({
      clientId: source.clientId,
      sourceId: source.id,
      failureReason: 'network_error',
      attempt: 3,
      maxAttempts: expect.any(Number),
      retryInMinutes: 4,
    })
    expect(publishSourceHealthStatus).toHaveBeenCalledWith(expect.objectContaining({
      clientId: source.clientId,
      sourceId: source.id,
      status: 'error',
      failureReason: 'network_error',
      consecutiveFailures: 3,
    }))
  })

  it('persists normalized items and emits ingest.error when duplicates detected', async () => {
    const source = buildSource()
    const normalized = {
      externalId: 'ext-1',
      title: 'Example Title',
      url: 'https://example.com/article',
      contentType: 'article' as const,
      publishedAt: now.toISOString(),
      publishedAtSource: 'original' as const,
      fetchedAt: now.toISOString(),
      extractedBody: 'Body text content.',
      excerpt: 'Body text content.',
    }

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: true,
      items: [
        {
          rawPayload: { html: '<article>Body</article>' },
          normalized,
          sourceMetadata: { contentType: 'article', canonicalUrl: source.canonicalUrl },
        },
      ],
      metadata: { adapter: 'http', itemCount: 1, skippedCount: 0 },
    })

    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [], duplicates: [{ rawHash: 'hash-1' }] })

    const result = await runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    expect(result.succeeded).toBe(1)
    expect(saveDiscoveryItems).toHaveBeenCalledWith({
      clientId: source.clientId,
      sourceId: source.id,
      items: expect.arrayContaining([
        expect.objectContaining({ normalized }),
      ]),
    })

    const metrics = vi.mocked(completeDiscoverySourceFetch).mock.calls[0][0].metrics as Record<string, unknown>
    expect(metrics).toMatchObject({ normalizedCount: 1, duplicateCount: 1 })

    const errorEvent = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'ingest.error')?.[0]
    expect(errorEvent?.payload).toMatchObject({
      clientId: source.clientId,
      sourceId: source.id,
      issues: expect.arrayContaining([expect.objectContaining({ reason: 'duplicate', count: 1 })]),
    })
  })

  it('publishes source health status when encountering permanent failures', async () => {
    const source = buildSource({ id: 'source-permanent', clientId: 'client-permanent', sourceType: 'rss' })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(completeDiscoverySourceFetch).mockResolvedValue(createHealth({
      status: 'error',
      consecutiveFailures: 3,
      failureReason: 'http_4xx',
      lastSuccessAt: null,
    }))
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: false,
      failureReason: 'http_4xx',
      metadata: { adapter: 'rss', status: 404 },
    })

    const result = await runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    expect(result.failed).toBe(1)
    expect(executeIngestionAdapter).toHaveBeenCalledTimes(1)
    expect(completeDiscoverySourceFetch).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      failureReason: 'http_4xx',
    }))
    expect(publishSourceHealthStatus).toHaveBeenCalledWith(expect.objectContaining({
      clientId: source.clientId,
      sourceId: source.id,
      status: 'error',
      failureReason: 'http_4xx',
      attempt: 1,
      consecutiveFailures: 3,
    }))
  })

  it('respects retry-after header for 429 responses and retries with override', async () => {
    const source = buildSource({ id: 'source-429', clientId: 'client-429', sourceType: 'rss' })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(executeIngestionAdapter)
      .mockResolvedValueOnce({
        ok: false,
        failureReason: 'http_4xx',
        metadata: { adapter: 'rss', status: 429 },
        raw: { headers: { 'Retry-After': '120' } },
      })
      .mockResolvedValueOnce({
        ok: true,
        items: [],
        metadata: { adapter: 'rss' },
      })

    const jobPromise = runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    await vi.advanceTimersByTimeAsync(120_000)

    const result = await jobPromise

    expect(result.succeeded).toBe(1)
    expect(executeIngestionAdapter).toHaveBeenCalledTimes(2)

    const { telemetry } = vi.mocked(completeDiscoverySourceFetch).mock.calls[0][0]
    expect(telemetry).toEqual(expect.objectContaining({
      attempts: expect.arrayContaining([
        expect.objectContaining({
          attempt: 1,
          retryInMinutes: 2,
          retryAfterOverride: true,
        }),
        expect.objectContaining({ attempt: 2, success: true }),
      ]),
      attemptCount: 2,
    }))

    const completionEvent = vi.mocked(emitDiscoveryEvent).mock.calls.find(([event]) => event.type === 'ingestion.completed')?.[0]
    expect(completionEvent?.payload.attempt).toBe(2)
    expect(completionEvent?.payload.retryInMinutes).toBeUndefined()
  })

  it('marks source as failed when adapter throws', async () => {
    const source = buildSource({ id: 'source-error' })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    const adapterError = new Error('boom')
    vi.mocked(executeIngestionAdapter).mockRejectedValue(adapterError)
    vi.mocked(completeDiscoverySourceFetch).mockResolvedValue(createHealth({
      status: 'warning',
      consecutiveFailures: 1,
      failureReason: 'unknown_error',
      lastSuccessAt: null,
    }))

    const result = await runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    expect(result.failed).toBe(1)
    expect(completeDiscoverySourceFetch).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      failureReason: 'unknown_error',
    }))
    expect(emitDiscoveryEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingestion.completed' }))
    expect(publishSourceHealthStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'warning',
      failureReason: 'unknown_error',
      consecutiveFailures: 1,
    }))
  })

  it('releases source when completion persistence fails', async () => {
    const source = buildSource({ id: 'source-reset', fetchIntervalMinutes: 15 })

    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([source])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(source)
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: false,
      failureReason: 'network_error',
      retryInMinutes: 1,
      metadata: { adapter: 'rss' },
      error: new Error('network'),
    })
    vi.mocked(completeDiscoverySourceFetch).mockRejectedValue(new Error('db offline'))
    vi.mocked(releaseDiscoverySourceAfterFailedCompletion).mockResolvedValue(createHealth({
      status: 'warning',
      consecutiveFailures: 1,
      failureReason: 'network_error',
      lastSuccessAt: null,
    }))

    const jobPromise = runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(120_000)

    const result = await jobPromise

    expect(result.failed).toBe(1)
    expect(releaseDiscoverySourceAfterFailedCompletion).toHaveBeenCalledWith(expect.objectContaining({
      sourceId: source.id,
      fetchIntervalMinutes: source.fetchIntervalMinutes,
      failureReason: 'network_error',
      retryInMinutes: 4,
      success: false,
    }))
    expect(releaseDiscoverySourceAfterFailedCompletion).toHaveBeenCalledTimes(1)
    expect(publishSourceHealthStatus).toHaveBeenCalledWith(expect.objectContaining({
      status: 'warning',
      failureReason: 'network_error',
      consecutiveFailures: 1,
    }))
  })
})
