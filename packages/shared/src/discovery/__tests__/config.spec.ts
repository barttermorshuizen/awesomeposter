import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEB_LIST_MAX_DEPTH,
  parseDiscoverySourceConfig,
  safeParseDiscoverySourceConfig,
  serializeDiscoverySourceConfig,
  createDefaultConfigForSource,
  hasWebListConfig,
} from '../config.js'

describe('discovery source config', () => {
  it('returns an empty object when raw config is null', () => {
    expect(parseDiscoverySourceConfig(null)).toEqual({})
  })

  it('normalizes youtube identifiers regardless of legacy keys', () => {
    const config = parseDiscoverySourceConfig({
      youtube: {
        channelId: '  UCExample ',
        playlistId: ' PLAYLIST123 ',
      },
    })
    expect(config.youtube?.channel).toBe('UCExample')
    expect(config.youtube?.playlist).toBe('PLAYLIST123')
  })

  it('provides a useful error when webList selectors are missing', () => {
    const result = safeParseDiscoverySourceConfig({
      webList: {
        item_selector: '.entry',
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.issues[0]?.message).toContain('Required')
    }
  })

  it('normalizes webList fields, selectors, and pagination defaults', () => {
    const config = parseDiscoverySourceConfig({
      webList: {
        list_container_selector: '.list ',
        item_selector: '.list-item',
        fields: {
          title: '.title ',
          url: { selector: 'a.article', attribute: ' href ' },
        },
        pagination: {
          next_page: { selector: '.next', attribute: 'href' },
        },
      },
    })
    expect(config.webList?.listContainerSelector).toBe('.list')
    expect(config.webList?.fields?.title?.selector).toBe('.title')
    expect(config.webList?.fields?.url?.attribute).toBe('href')
    expect(config.webList?.pagination?.maxDepth).toBe(DEFAULT_WEB_LIST_MAX_DEPTH)
    expect(hasWebListConfig(config)).toBe(true)
  })

  it('serializes normalized config back to storage format', () => {
    const normalized = parseDiscoverySourceConfig({
      webList: {
        list_container_selector: '.cards',
        item_selector: '.card',
        fields: {
          title: '.card-title',
          timestamp: { selector: 'time', attribute: 'datetime' },
        },
        pagination: {
          next_page: { selector: '.pagination a.next', attribute: 'href' },
          max_depth: 3,
        },
      },
    })
    const serialized = serializeDiscoverySourceConfig(normalized)
    expect(serialized?.webList).toMatchObject({
      list_container_selector: '.cards',
      item_selector: '.card',
      pagination: {
        next_page: {
          selector: '.pagination a.next',
          attribute: 'href',
        },
        max_depth: 3,
      },
    })
  })

  it('emits defaults for known source types', () => {
    expect(createDefaultConfigForSource('youtube-channel', '  UC123  ')).toEqual({
      youtube: { channel: 'UC123' },
    })
    expect(createDefaultConfigForSource('rss', 'ignored')).toEqual({
      rss: { canonical: true },
    })
    expect(createDefaultConfigForSource('web-page', 'ignored')).toBeNull()
  })
})
