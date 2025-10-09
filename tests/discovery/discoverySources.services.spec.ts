import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  updateDiscoverySourceWebListConfig,
  checkWebListConfig,
} from '@/services/discovery/sources'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const SOURCE_ID = '22222222-2222-4222-8222-222222222222'

describe('discovery source services', () => {
  const originalFetch = global.fetch

  beforeEach(() => {
    global.fetch = vi.fn() as unknown as typeof fetch
  })

  afterEach(() => {
    vi.resetAllMocks()
    global.fetch = originalFetch
  })

  it('sends patch request to persist web list config', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        ok: true,
        source: {
          id: SOURCE_ID,
          clientId: CLIENT_ID,
          url: 'https://example.com',
          canonicalUrl: 'https://example.com',
          sourceType: 'web-page',
          identifier: 'example.com',
          notes: null,
          configJson: null,
          updatedAt: new Date().toISOString(),
        },
        warnings: ['Test warning'],
        suggestionAcknowledged: true,
      }),
    })

    const result = await updateDiscoverySourceWebListConfig(CLIENT_ID, SOURCE_ID, {
      webList: {
        listContainerSelector: '.feed',
        itemSelector: '.entry',
        fields: {},
      },
      suggestionId: 'suggestion-1',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]
    expect(init?.method).toBe('PATCH')
    const body = JSON.parse(init?.body as string)
    expect(body.webList).toMatchObject({ list_container_selector: '.feed', item_selector: '.entry' })
    expect(body.suggestionId).toBe('suggestion-1')
    expect(result.warnings).toContain('Test warning')
  })

  it('throws when update request fails', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => 'text/plain' },
      text: async () => 'Server error',
    })

    await expect(updateDiscoverySourceWebListConfig(CLIENT_ID, SOURCE_ID, { webList: null }))
      .rejects.toThrow('Server error')
  })

  it('posts to preview endpoint and returns preview result', async () => {
    const mockFetch = global.fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'application/json' },
      json: async () => ({
        ok: true,
        result: {
          item: {
            title: 'Example',
            url: 'https://example.com/item',
            excerpt: 'Summary',
            timestamp: new Date().toISOString(),
          },
          warnings: [],
          fetchedAt: new Date().toISOString(),
        },
      }),
    })

    const result = await checkWebListConfig(CLIENT_ID, SOURCE_ID, {
      webList: {
        listContainerSelector: '.feed',
        itemSelector: '.entry',
        fields: {},
      },
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const [, init] = mockFetch.mock.calls[0]
    expect(init?.method).toBe('POST')
    const body = JSON.parse(init?.body as string)
    expect(body.webList).toMatchObject({ list_container_selector: '.feed', item_selector: '.entry' })
    expect(result.result.item?.title).toBe('Example')
  })
})
