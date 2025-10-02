import { describe, expect, it } from 'vitest'
import {
  normalizeDiscoveryKeyword,
  deriveDiscoveryKeywordDuplicateKey,
} from '../src/discovery'
import { discoveryKeywordUpdatedEventSchema } from '../src/discovery-events'

describe('normalizeDiscoveryKeyword', () => {
  it('produces lowercase canonical keyword with collapsed whitespace', () => {
    const result = normalizeDiscoveryKeyword('  Account   Based  Marketing ')
    expect(result.cleaned).toBe('Account Based Marketing')
    expect(result.canonical).toBe('account based marketing')
    expect(result.duplicateKey).toBe('account based marketing')
  })

  it('rejects non-ASCII input', () => {
    expect(() => normalizeDiscoveryKeyword('café strategy')).toThrow('Keywords must use ASCII characters only')
  })

  it('rejects entries that exceed the length limit', () => {
    const longWord = 'a'.repeat(41)
    expect(() => normalizeDiscoveryKeyword(longWord)).toThrow('Keywords must be 40 characters or fewer')
  })
})

describe('deriveDiscoveryKeywordDuplicateKey', () => {
  it('treats hyphen and space variants as duplicates', () => {
    const hyphenKey = deriveDiscoveryKeywordDuplicateKey('Account-Based Marketing')
    const spaceKey = deriveDiscoveryKeywordDuplicateKey('account based marketing')
    expect(hyphenKey).toBe(spaceKey)
  })
})

describe('discoveryKeywordUpdatedEventSchema', () => {
  it('accepts keyword updated SSE envelopes', () => {
    const payload = {
      type: 'keyword.updated' as const,
      version: 1,
      payload: {
        clientId: '6f05fe7e-2f78-4ce0-9cf3-9f08fcb28ed5',
        keywords: ['account based marketing', 'product marketing'],
        updatedAt: new Date().toISOString(),
      },
    }

    expect(() => discoveryKeywordUpdatedEventSchema.parse(payload)).not.toThrow()
  })
})
