import { describe, it, expect, beforeEach, vi } from 'vitest'
import { fetchHttpSource } from '../adapters/http.js'
import type { DiscoveryAdapterResult } from '../ingestion.js'

function createResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers,
  })
}

const LIST_HTML = `
  <html>
    <body>
      <section class="feed">
        <article class="entry">
          <h2 class="title"><a href="/post-1">First Post • Launch Plan</a></h2>
          <p class="summary">Overview of the launch plan.</p>
          <time class="time" data-published="2025-03-01T08:00:00Z"></time>
        </article>
        <article class="entry">
          <h2 class="title"><a href="/post-2">Second Post &amp; KPI Review</a></h2>
          <div class="summary">Quarterly KPI highlights.</div>
          <time class="time" data-published="2025-03-02T09:00:00Z"></time>
        </article>
        <article class="entry">
          <a class="title" href="/post-3">Third Post: Retrospective</a>
          <time class="time" data-published="1710000000"></time>
        </article>
      </section>
    </body>
  </html>
`

describe('fetchHttpSource web list extraction', () => {
  const now = new Date('2025-04-01T12:00:00Z')

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('extracts list items using configured selectors and reports telemetry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createResponse(LIST_HTML))

    const result = (await fetchHttpSource(
      {
        sourceId: 'source-list',
        clientId: 'client-1',
        sourceType: 'web-page',
        url: 'https://example.com/news',
        canonicalUrl: 'https://example.com/news',
        config: {
          webList: {
            listContainerSelector: '.feed',
            itemSelector: '.entry',
            fields: {
              title: {
                selector: '.title',
                valueTransform: {
                  pattern: '^(.*?)\\s•.*$',
                  replacement: '$1',
                },
              },
              excerpt: { selector: '.summary' },
              url: { selector: '.title', attribute: 'href' },
              timestamp: { selector: '.time', attribute: 'data-published' },
            },
          },
        },
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.items).toHaveLength(3)

    const [first, second, third] = result.items
    expect(first.normalized.title).toBe('First Post')
    expect(first.normalized.url).toBe('https://example.com/post-1')
    expect(first.normalized.publishedAt).toBe('2025-03-01T08:00:00.000Z')

    expect(second.normalized.title).toBe('Second Post & KPI Review')
    expect(second.normalized.excerpt).toContain('Quarterly KPI highlights')

    expect(third.normalized.title).toBe('Third Post: Retrospective')
    expect(third.normalized.publishedAtSource).toBe('original')

    const metadata = result.metadata as Record<string, unknown>
    expect(metadata).toMatchObject({
      adapter: 'http',
      webListConfigured: true,
      webListApplied: true,
      listItemCount: 3,
      itemCount: 3,
      valueTransformApplied: 1,
      valueTransformMisses: 2,
    })
    const thirdRaw = third.rawPayload as Record<string, unknown>
    expect(Array.isArray(thirdRaw.fields)).toBe(false)
    expect(thirdRaw.fields).toEqual(expect.objectContaining({ url: '/post-3' }))
    expect(thirdRaw.valueTransformStates).toEqual({ title: 'missed' })
    const firstRaw = first.rawPayload as Record<string, unknown>
    expect(firstRaw.valueTransformStates).toEqual({ title: 'applied' })
    const secondRaw = second.rawPayload as Record<string, unknown>
    expect(secondRaw.valueTransformStates).toEqual({ title: 'missed' })
  })

  it('falls back to anchor text and body when specific field mappings are absent', async () => {
    const fallbackHtml = `
      <html>
        <body>
          <div class="articles">
            <div class="card">
              <a href="/overview">Overview Update</a>
            </div>
          </div>
        </body>
      </html>
    `

    const fetchMock = vi.fn().mockResolvedValue(createResponse(fallbackHtml))

    const result = (await fetchHttpSource(
      {
        sourceId: 'source-fallback',
        clientId: 'client-1',
        sourceType: 'web-page',
        url: 'https://example.com/list',
        canonicalUrl: 'https://example.com/list',
        config: {
          webList: {
            listContainerSelector: '.articles',
            itemSelector: '.card',
            fields: {
              url: { selector: 'a', attribute: 'href' },
            },
          },
        },
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.items).toHaveLength(1)
    const [item] = result.items
    expect(item.normalized.title).toBe('Overview Update')
    expect(item.normalized.excerpt).toContain('Overview Update')
    expect(item.normalized.url).toBe('https://example.com/overview')

    const metadata = result.metadata as Record<string, unknown>
    expect(metadata).toMatchObject({
      webListConfigured: true,
      webListApplied: true,
      listItemCount: 1,
      valueTransformApplied: 0,
      valueTransformMisses: 0,
    })
  })

  it('falls back to single-item extraction when selectors do not match', async () => {
    const fetchMock = vi.fn().mockResolvedValue(createResponse(LIST_HTML))

    const result = (await fetchHttpSource(
      {
        sourceId: 'source-miss',
        clientId: 'client-1',
        sourceType: 'web-page',
        url: 'https://example.com/news',
        canonicalUrl: 'https://example.com/news',
        config: {
          webList: {
            listContainerSelector: '.missing',
            itemSelector: '.entry',
          },
        },
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.items).toHaveLength(1)
    const metadata = result.metadata as Record<string, unknown>
    expect(metadata).toMatchObject({
      webListConfigured: true,
      webListApplied: false,
      listItemCount: 0,
      valueTransformApplied: 0,
      valueTransformMisses: 0,
    })
    expect(Array.isArray(metadata.webListIssues)).toBe(true)
  })
})
