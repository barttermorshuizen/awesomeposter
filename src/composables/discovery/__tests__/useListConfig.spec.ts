import { describe, expect, it } from 'vitest'
import { useListConfig } from '../useListConfig'
import type { DiscoverySourceWebListConfig } from '@awesomeposter/shared'

describe('useListConfig', () => {
  it('initialises form state with existing value transforms', () => {
    const config: DiscoverySourceWebListConfig = {
      listContainerSelector: '.feed',
      itemSelector: '.entry',
      fields: {
        title: {
          selector: '.title',
          valueTransform: {
            pattern: '^(.*?)\\s•.*$',
            replacement: '$1',
          },
          legacyValueTemplate: '{{ value }} • extra',
          valueTransformWarnings: ['Needs review'],
        },
      },
    }

    const listConfig = useListConfig({
      initialConfig: config,
      initialEnabled: true,
      suggestion: null,
    })

    expect(listConfig.form.fields.title.valueTransformEnabled).toBe(true)
    expect(listConfig.form.fields.title.valueTransformPattern).toBe('^(.*?)\\s•.*$')
    expect(listConfig.form.fields.title.valueTransformReplacement).toBe('$1')
    expect(listConfig.form.fields.title.legacyValueTemplate).toBe('{{ value }} • extra')
    expect(listConfig.form.fields.title.valueTransformWarnings).toEqual(['Needs review'])
  })

  it('fails validation when regex transform is enabled without a pattern', () => {
    const listConfig = useListConfig({
      initialConfig: null,
      initialEnabled: true,
      suggestion: null,
    })

    const { form } = listConfig
    form.enabled = true
    form.listContainerSelector = '.feed'
    form.itemSelector = '.entry'
    form.fields.url.selector = '.link'
    form.fields.url.valueTransformEnabled = true
    form.fields.url.valueTransformPattern = '   '

    const result = listConfig.validate()
    expect(result.valid).toBe(false)
    expect(listConfig.errors.value['fields.url.valueTransform.pattern']).toBeTruthy()
  })

  it('returns config with regex value transform when pattern is provided', () => {
    const listConfig = useListConfig({
      initialConfig: null,
      initialEnabled: true,
      suggestion: null,
    })

    const { form } = listConfig
    form.enabled = true
    form.listContainerSelector = '.feed'
    form.itemSelector = '.entry'
    form.fields.title.selector = '.title'
    form.fields.title.valueTransformEnabled = true
    form.fields.title.valueTransformPattern = '^(.*)$'
    form.fields.title.valueTransformReplacement = 'Prefix $1'

    const result = listConfig.validate()
    expect(result.valid).toBe(true)
    expect(result.config?.fields?.title?.valueTransform).toEqual({
      pattern: '^(.*)$',
      replacement: 'Prefix $1',
    })
    expect(result.raw).toMatchObject({
      fields: {
        title: {
          valueTransform: {
            pattern: '^(.*)$',
            replacement: 'Prefix $1',
          },
        },
      },
    })
  })
})
