import { describe, expect, it } from 'vitest'
import { useListConfig } from '@/composables/discovery/useListConfig'
import type { DiscoverySourceWebListConfig } from '@awesomeposter/shared'
import type { WebListSuggestionState } from '@/stores/discoverySources'

describe('useListConfig', () => {
  it('reports validation errors when required selectors are missing', () => {
    const listConfig = useListConfig({
      initialConfig: null,
      initialEnabled: false,
    })

    listConfig.form.enabled = true
    listConfig.form.listContainerSelector = ''
    listConfig.form.itemSelector = ''

    const result = listConfig.validate()
    expect(result.valid).toBe(false)
    expect(listConfig.errors.value.listContainerSelector).toBeTruthy()
    expect(listConfig.errors.value.itemSelector).toBeTruthy()
  })

  it('builds a normalized config when selectors are provided', () => {
    const listConfig = useListConfig({
      initialConfig: null,
      initialEnabled: false,
    })

    listConfig.form.enabled = true
    listConfig.form.listContainerSelector = '.feed'
    listConfig.form.itemSelector = '.entry'
    listConfig.form.fields.title.selector = '.title'

    const result = listConfig.validate()
    expect(result.valid).toBe(true)
    expect(result.config).not.toBeNull()
    expect(result.config?.listContainerSelector).toBe('.feed')
    expect(result.config?.itemSelector).toBe('.entry')
    expect(result.config?.fields.title?.selector).toBe('.title')
  })

  it('applies and discards suggestions', () => {
    const baseConfig: DiscoverySourceWebListConfig = {
      listContainerSelector: '.articles',
      itemSelector: '.article',
      fields: {},
    }

    const listConfig = useListConfig({
      initialConfig: baseConfig,
      initialEnabled: true,
    })

    const suggestion: WebListSuggestionState = {
      id: 'suggestion-1',
      config: {
        listContainerSelector: '.suggested',
        itemSelector: '.suggested-item',
        fields: {
          title: { selector: '.headline' },
        },
      },
      warnings: ['Double-check selector scope'],
      confidence: 0.8,
      receivedAt: new Date().toISOString(),
      acknowledged: false,
    }

    listConfig.applySuggestion(suggestion)
    expect(listConfig.form.listContainerSelector).toBe('.suggested')
    expect(listConfig.form.itemSelector).toBe('.suggested-item')
    expect(listConfig.appliedSuggestionId.value).toBe('suggestion-1')

    listConfig.discardSuggestion(baseConfig, true)
    expect(listConfig.form.listContainerSelector).toBe('.articles')
    expect(listConfig.form.itemSelector).toBe('.article')
    expect(listConfig.appliedSuggestionId.value).toBeNull()
  })
})
