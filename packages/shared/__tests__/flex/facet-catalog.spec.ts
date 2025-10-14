import { describe, expect, it } from 'vitest'

import { FacetCatalog, FacetCatalogError, getFacetCatalog } from '../../src/flex/facets/index.js'

describe('FacetCatalog', () => {
  it('returns default catalog entries', () => {
    const catalog = getFacetCatalog()
    const toneOfVoice = catalog.get('toneOfVoice')
    expect(toneOfVoice.title).toBe('Tone of Voice')
  })

  it('filters by direction', () => {
    const catalog = getFacetCatalog()
    const inputOnly = catalog.list({ direction: 'input' })
    expect(inputOnly.every((facet) => facet.metadata.direction !== 'output')).toBe(true)
  })

  it('throws when facet is missing', () => {
    const catalog = getFacetCatalog()
    expect(() => catalog.get('missingFacet')).toThrowError(FacetCatalogError)
  })

  it('guards against direction mismatch', () => {
    const catalog = new FacetCatalog([
      {
        name: 'outputOnly',
        title: 'Output Only',
        description: 'demo facet',
        schema: { type: 'string' },
        semantics: { instruction: 'Emit outputOnly string.' },
        metadata: {
          version: 'v1',
          direction: 'output',
          requiredByDefault: true
        }
      }
    ])

    expect(() => catalog.resolveMany(['outputOnly'], 'input')).toThrowError(FacetCatalogError)
  })
})
