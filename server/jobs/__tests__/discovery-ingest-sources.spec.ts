import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

vi.mock('../../utils/discovery-repository', () => ({
  listDiscoverySourcesDue: vi.fn(),
  claimDiscoverySourceForFetch: vi.fn(),
  completeDiscoverySourceFetch: vi.fn(),
  releaseDiscoverySourceAfterFailedCompletion: vi.fn(),
  saveDiscoveryItems: vi.fn(),
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

import type { DiscoveryAdapterResult } from '@awesomeposter/shared'
import { runDiscoveryIngestionJob } from '../discovery/ingest-sources'
import {
  listDiscoverySourcesDue,
  claimDiscoverySourceForFetch,
  completeDiscoverySourceFetch,
  releaseDiscoverySourceAfterFailedCompletion,
  saveDiscoveryItems,
} from '../../utils/discovery-repository'
import { executeIngestionAdapter } from '@awesomeposter/shared'
import { emitDiscoveryEvent } from '../../utils/discovery-events'
import { publishSourceHealthStatus } from '../../utils/discovery-health'

describe('runDiscoveryIngestionJob', () => {
  const now = new Date('2025-04-01T10:00:00Z')

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

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(now)
    vi.resetAllMocks()
    vi.mocked(listDiscoverySourcesDue).mockResolvedValue([])
    vi.mocked(claimDiscoverySourceForFetch).mockResolvedValue(null)
    vi.mocked(completeDiscoverySourceFetch).mockResolvedValue(undefined)
    vi.mocked(releaseDiscoverySourceAfterFailedCompletion).mockResolvedValue(undefined)
    vi.mocked(executeIngestionAdapter).mockResolvedValue({
      ok: true,
      items: [],
      metadata: { adapter: 'http' },
    } satisfies DiscoveryAdapterResult)
    vi.mocked(saveDiscoveryItems).mockResolvedValue({ inserted: [], duplicates: [] })
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
    expect(metrics).toMatchObject({ normalizedCount: 0, insertedCount: 0, duplicateCount: 0 })
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

    const result = await runDiscoveryIngestionJob({ now: () => new Date(now), workerLimit: 1 })

    expect(result.failed).toBe(1)
    expect(completeDiscoverySourceFetch).toHaveBeenCalledWith(expect.objectContaining({
      success: false,
      failureReason: 'unknown_error',
    }))
    expect(emitDiscoveryEvent).toHaveBeenCalledWith(expect.objectContaining({ type: 'ingestion.completed' }))
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
  })
})
