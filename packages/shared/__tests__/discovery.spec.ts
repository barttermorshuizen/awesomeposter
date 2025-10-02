import { describe, expect, it } from 'vitest'
import { normalizeDiscoverySourceUrl, deriveDuplicateKey } from '../src/discovery'

describe('normalizeDiscoverySourceUrl', () => {
  it('rejects non-http protocols', () => {
    expect(() => normalizeDiscoverySourceUrl('ftp://example.com')).toThrow('Only HTTP(S) URLs are supported')
  })

  it('detects YouTube channel route', () => {
    const result = normalizeDiscoverySourceUrl('https://www.youtube.com/channel/UC123ABC/?utm_source=test')
    expect(result.sourceType).toBe('youtube-channel')
    expect(result.identifier).toBe('UC123ABC')
    expect(result.canonicalUrl).toBe('https://www.youtube.com/channel/UC123ABC')
  })

  it('detects YouTube playlist', () => {
    const result = normalizeDiscoverySourceUrl('https://youtube.com/playlist?list=PL12345&feature=share')
    expect(result.sourceType).toBe('youtube-playlist')
    expect(result.identifier).toBe('PL12345')
    expect(result.canonicalUrl).toBe('https://youtube.com/playlist?list=PL12345')
  })

  it('canonicalizes RSS feeds with xml suffix', () => {
    const result = normalizeDiscoverySourceUrl('https://blog.example.com/feed.xml?utm=abc')
    expect(result.sourceType).toBe('rss')
    expect(result.canonicalUrl).toBe('https://blog.example.com/feed.xml')
  })

  it('falls back to web-page for standard URLs', () => {
    const result = normalizeDiscoverySourceUrl('https://www.example.com/articles/Latest/')
    expect(result.sourceType).toBe('web-page')
    expect(result.canonicalUrl).toBe('https://www.example.com/articles/Latest')
  })
})

describe('deriveDuplicateKey', () => {
  it('creates stable keys for duplicates', () => {
    const first = normalizeDiscoverySourceUrl('https://EXAMPLE.com/news/')
    const second = normalizeDiscoverySourceUrl('https://example.com/news')
    expect(deriveDuplicateKey(first)).toBe(deriveDuplicateKey(second))
  })
})
