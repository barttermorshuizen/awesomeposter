import { describe, it, expect } from 'vitest'
import { buildYoutubeDataApiRequest } from '../../discovery/youtube.js'

function asUrl(value: string) {
  return new URL(value)
}

describe('buildYoutubeDataApiRequest', () => {
  it('creates playlistItems request for channel ID URLs', () => {
    const result = buildYoutubeDataApiRequest('https://www.youtube.com/channel/UCabcd1234efgh5678ijklmn')
    expect(result.type).toBe('channelUploads')
    if (result.type !== 'channelUploads') return
    expect(result.channelId).toBe('UCabcd1234efgh5678ijklmn')
    expect(result.playlistId).toBe('UUabcd1234efgh5678ijklmn')
    const url = asUrl(result.url)
    expect(url.pathname.endsWith('/playlistItems')).toBe(true)
    expect(url.searchParams.get('playlistId')).toBe('UUabcd1234efgh5678ijklmn')
    expect(url.searchParams.get('part')).toBe('snippet,contentDetails')
    expect(url.searchParams.get('maxResults')).toBe('50')
  })

  it('builds channels lookup for handle URLs', () => {
    const result = buildYoutubeDataApiRequest('https://www.youtube.com/@awesomeposter')
    expect(result.type).toBe('resolveHandle')
    if (result.type !== 'resolveHandle') return
    expect(result.handle).toBe('@awesomeposter')
    const url = asUrl(result.url)
    expect(url.pathname.endsWith('/channels')).toBe(true)
    expect(url.searchParams.get('forHandle')).toBe('@awesomeposter')
    expect(url.searchParams.get('part')).toBe('id')
  })

  it('builds username lookup for /user/ URLs', () => {
    const result = buildYoutubeDataApiRequest('https://www.youtube.com/user/SomeLegacyName')
    expect(result.type).toBe('resolveUsername')
    if (result.type !== 'resolveUsername') return
    expect(result.username).toBe('SomeLegacyName')
    const url = asUrl(result.url)
    expect(url.searchParams.get('forUsername')).toBe('SomeLegacyName')
  })

  it('falls back to search for custom /c/ URLs', () => {
    const result = buildYoutubeDataApiRequest('https://www.youtube.com/c/CustomBrand/videos')
    expect(result.type).toBe('searchChannel')
    if (result.type !== 'searchChannel') return
    expect(result.query).toBe('CustomBrand')
    const url = asUrl(result.url)
    expect(url.pathname.endsWith('/search')).toBe(true)
    expect(url.searchParams.get('type')).toBe('channel')
    expect(url.searchParams.get('q')).toBe('CustomBrand')
  })

  it('creates playlistItems request for playlist URLs', () => {
    const result = buildYoutubeDataApiRequest('https://www.youtube.com/playlist?list=PL1234567890abcdef')
    expect(result.type).toBe('playlistItems')
    if (result.type !== 'playlistItems') return
    expect(result.playlistId).toBe('PL1234567890abcdef')
    const url = asUrl(result.url)
    expect(url.searchParams.get('playlistId')).toBe('PL1234567890abcdef')
  })

  it('includes API key when provided', () => {
    const result = buildYoutubeDataApiRequest('https://www.youtube.com/channel/UCxyz1234567890abcdefg', {
      apiKey: 'secret-key',
      maxResults: 10,
    })
    expect(result.type).toBe('channelUploads')
    if (result.type !== 'channelUploads') return
    const url = asUrl(result.url)
    expect(url.searchParams.get('key')).toBe('secret-key')
    expect(url.searchParams.get('maxResults')).toBe('10')
  })
})

