import { describe, it, expect, vi } from 'vitest'
import { fetchHttpSource } from '../adapters/http.js'
import { fetchRssSource } from '../adapters/rss.js'
import { fetchYoutubeSource } from '../adapters/youtube.js'
import type { DiscoveryAdapterResult } from '../ingestion.js'
import type { YoutubeSourceMetadata } from '../../discovery.js'

function createResponse(body: string, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, {
    status,
    headers,
  })
}

function isAscii(text: string) {
  return [...text].every((char) => char.charCodeAt(0) <= 0x7f)
}

describe('discovery normalization adapters', () => {
  const now = new Date('2025-04-01T12:00:00Z')

  it('sanitizes HTML articles, removes boilerplate, and truncates to 5,000 chars', async () => {
    const repeatedSentence = 'This sentence should appear in the normalized body.'
    const longParagraph = Array.from({ length: 200 }, () => repeatedSentence).join(' ')
    const html = `
      <html lang="en">
        <head>
          <title>“Smart” Article — Example</title>
          <meta property="article:published_time" content="2025-03-31T18:30:00Z" />
        </head>
        <body>
          <nav>Navigation Should Be Removed</nav>
          <article>
            <p>${longParagraph}</p>
            <p>${longParagraph}</p>
            <script>console.log('ignored')</script>
          </article>
        </body>
      </html>
    `

    const fetchMock = vi.fn().mockResolvedValue(createResponse(html))

    const result = (await fetchHttpSource(
      {
        sourceId: 'source-1',
        clientId: 'client-1',
        sourceType: 'web-page',
        url: 'https://example.com/article',
        canonicalUrl: 'https://example.com/article',
        config: null,
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(1)
    const [item] = result.items
    expect(item.normalized.title).toBe('"Smart" Article -- Example')
    expect(item.normalized.publishedAtSource).toBe('original')
    expect(item.normalized.publishedAt).toBe('2025-03-31T18:30:00.000Z')
    expect(item.normalized.fetchedAt).toBe(now.toISOString())
    expect(item.normalized.extractedBody.includes('Navigation')).toBe(false)
    expect(item.normalized.extractedBody.length).toBeLessThanOrEqual(5_000)
    expect(isAscii(item.normalized.extractedBody)).toBe(true)
    expect(result.metadata?.itemCount).toBe(1)
  })

  it('normalizes RSS entries and falls back to fetched timestamp when publish date missing', async () => {
    const feed = `
      <rss version="2.0">
        <channel>
          <title>Example Feed</title>
          <item>
            <title>First Entry</title>
            <link>https://example.com/entry-1</link>
            <description><![CDATA[<p>Body with <strong>HTML</strong> content.</p>]]></description>
          </item>
        </channel>
      </rss>
    `

    const fetchMock = vi.fn().mockResolvedValue(createResponse(feed))

    const result = (await fetchRssSource(
      {
        sourceId: 'source-1',
        clientId: 'client-1',
        sourceType: 'rss',
        url: 'https://example.com/feed.xml',
        canonicalUrl: 'https://example.com/feed.xml',
        config: null,
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(1)
    const [item] = result.items
    expect(item.normalized.publishedAtSource).toBe('fallback')
    expect(item.normalized.publishedAt).toBe(now.toISOString())
    expect(item.normalized.extractedBody).toContain('Body with HTML content.')
    expect(item.sourceMetadata).toMatchObject({ contentType: 'rss', feedUrl: 'https://example.com/feed.xml' })
    expect(result.metadata?.skippedCount).toBe(0)
  })

  it('maps YouTube description and transcript metadata correctly', async () => {
    const apiBody = JSON.stringify({
      items: [
        {
          id: 'video-123',
          snippet: {
            title: 'First Video',
            description: 'Description only',
            publishedAt: '2025-03-30T08:15:00Z',
            channelId: 'channel-1',
          },
          contentDetails: { duration: 'PT4M10S' },
          transcript: null,
        },
        {
          id: { videoId: 'video-456' },
          snippet: {
            title: 'Second Video',
            description: 'Placeholder description',
            publishedAt: '2025-03-30T08:20:00Z',
            channelId: 'channel-1',
          },
          contentDetails: { duration: 'PT1H1M' },
          transcript: { text: 'Transcript content here.', available: true },
        },
      ],
    })

    const fetchMock = vi.fn().mockResolvedValue(createResponse(apiBody, 200, { 'content-type': 'application/json' }))

    const originalKey = process.env.YOUTUBE_API_KEY
    process.env.YOUTUBE_API_KEY = 'test-key'

    const channelId = 'UCabc1234567890abcdef'

    const result = (await fetchYoutubeSource(
      {
        sourceId: 'source-yt',
        clientId: 'client-1',
        sourceType: 'youtube-channel',
        url: `https://www.youtube.com/channel/${channelId}`,
        canonicalUrl: `https://www.youtube.com/channel/${channelId}`,
        config: { youtube: { channel: channelId } },
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    if (originalKey === undefined) {
      delete process.env.YOUTUBE_API_KEY
    } else {
      process.env.YOUTUBE_API_KEY = originalKey
    }

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.items).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [requestedUrl] = fetchMock.mock.calls[0]!
    expect(requestedUrl).toContain('playlistItems')
    expect(requestedUrl).toContain('key=test-key')

    const first = result.items[0]
    const second = result.items[1]

    expect(first.normalized.url).toBe('https://www.youtube.com/watch?v=video-123')
    expect(first.sourceMetadata).toMatchObject({ transcriptAvailable: false, durationSeconds: 250 })

    expect(second.normalized.extractedBody).toContain('Transcript content here.')
    expect(second.sourceMetadata).toMatchObject({ transcriptAvailable: true, durationSeconds: 3660 })
    expect(result.metadata?.itemCount).toBe(2)
    expect(result.metadata?.skippedCount).toBe(0)
    expect((result.metadata as Record<string, unknown>).requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'channelUploads', status: 200 }),
      ]),
    )
  })

  it('resolves handle-based channels before fetching playlist items', async () => {
    const handleResponse = JSON.stringify({
      items: [
        { id: 'UC123handleResolved', snippet: { title: 'Example Channel' } },
      ],
    })

    const playlistResponse = JSON.stringify({
      items: [
        {
          id: 'video-999',
          snippet: {
            title: 'Handle Video',
            description: 'Video from handle channel',
            publishedAt: '2025-03-29T00:00:00Z',
            channelId: 'UC123handleResolved',
          },
          contentDetails: { duration: 'PT10M' },
          transcript: null,
        },
      ],
    })

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(createResponse(handleResponse, 200, { 'content-type': 'application/json' }))
      .mockResolvedValueOnce(createResponse(playlistResponse, 200, { 'content-type': 'application/json' }))

    const originalKey = process.env.YOUTUBE_API_KEY
    process.env.YOUTUBE_API_KEY = 'test-key'

    const result = (await fetchYoutubeSource(
      {
        sourceId: 'source-yt',
        clientId: 'client-1',
        sourceType: 'youtube-channel',
        url: 'https://www.youtube.com/@awesomeposter',
        canonicalUrl: 'https://www.youtube.com/@awesomeposter',
        config: { youtube: { channel: '@awesomeposter' } },
      },
      { fetch: fetchMock, now: () => now },
    )) as DiscoveryAdapterResult

    if (originalKey === undefined) {
      delete process.env.YOUTUBE_API_KEY
    } else {
      process.env.YOUTUBE_API_KEY = originalKey
    }

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [firstRequestUrl] = fetchMock.mock.calls[0]!
    expect(firstRequestUrl).toContain('/channels')
    const [secondRequestUrl] = fetchMock.mock.calls[1]!
    expect(secondRequestUrl).toContain('/playlistItems')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].normalized.url).toBe('https://www.youtube.com/watch?v=video-999')
    const metadata = result.items[0].sourceMetadata as YoutubeSourceMetadata
    expect(metadata.channelId).toBe('UC123handleResolved')
    expect((result.metadata as Record<string, unknown>).requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'resolveHandle', status: 200 }),
        expect.objectContaining({ type: 'channelUploads', status: 200 }),
      ]),
    )
  })
})
