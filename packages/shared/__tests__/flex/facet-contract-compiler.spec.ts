import { describe, expect, it } from 'vitest'

import {
  FacetCatalog,
  FacetContractCompiler,
  FacetContractError,
  getFacetCatalog
} from '../../src/flex/facets/index.js'

describe('FacetContractCompiler', () => {
  it('merges schemas and preserves provenance', () => {
    const compiler = new FacetContractCompiler()
    const compiled = compiler.compileContracts({
      inputFacets: ['toneOfVoice', 'writerBrief'],
      outputFacets: ['copyVariants']
    })

    expect(compiled.input).toBeDefined()
    expect(compiled.input?.schema.properties?.toneOfVoice).toBeDefined()
    expect(compiled.input?.schema.properties?.writerBrief).toBeDefined()
    expect(compiled.input?.schema.required).toEqual(expect.arrayContaining(['toneOfVoice', 'writerBrief']))

    expect(compiled.output?.schema.properties?.copyVariants).toBeDefined()
    expect(compiled.output?.provenance).toHaveLength(1)

    const validation = compiled.input?.validator({
      toneOfVoice: 'Warm & Friendly',
      writerBrief: {
        angle: 'Celebrate developer productivity',
        keyPoints: ['Highlight automation impact']
      }
    })
    expect(validation).toEqual({ valid: true, errors: undefined })
  })

  it('returns validation errors with facet provenance', () => {
    const compiler = new FacetContractCompiler()
    const compiled = compiler.compileContracts({
      inputFacets: ['toneOfVoice', 'writerBrief']
    })

    const validation = compiled.input?.validator({
      toneOfVoice: 'invalid-tone',
      writerBrief: {
        keyPoints: []
      }
    })

    expect(validation?.valid).toBe(false)
    expect(validation?.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          facet: 'toneOfVoice',
          pointer: '/toneOfVoice'
        })
      ])
    )
  })

  it('throws on conflicting property types', () => {
    const catalog = new FacetCatalog([
      {
        name: 'facetA',
        title: 'Facet A',
        description: 'facet',
        schema: { type: 'string' },
        semantics: { instruction: 'Use facetA' },
        metadata: {
          version: 'v1',
          direction: 'input',
          requiredByDefault: true,
          propertyKey: 'shared'
        }
      },
      {
        name: 'facetB',
        title: 'Facet B',
        description: 'facet',
        schema: { type: 'object', properties: {}, additionalProperties: false },
        semantics: { instruction: 'Use facetB' },
        metadata: {
          version: 'v1',
          direction: 'input',
          requiredByDefault: true,
          propertyKey: 'shared'
        }
      }
    ])

    const compiler = new FacetContractCompiler({ catalog })
    expect(() => compiler.compileContracts({ inputFacets: ['facetA', 'facetB'] })).toThrowError(FacetContractError)
  })

  it('throws on conflicting enums', () => {
    const catalog = getFacetCatalog()
    const conflictingCatalog = new FacetCatalog([
      catalog.get('toneOfVoice'),
      {
        name: 'altTone',
        title: 'Alt Tone',
        description: 'conflicting enum',
        schema: { type: 'string', enum: ['relaxed'] },
        semantics: { instruction: 'Use alternate tone' },
        metadata: {
          version: 'v1',
          direction: 'input',
          requiredByDefault: true,
          propertyKey: 'toneOfVoice'
        }
      }
    ])

    const compiler = new FacetContractCompiler({ catalog: conflictingCatalog })
    expect(() => compiler.compileContracts({ inputFacets: ['toneOfVoice', 'altTone'] })).toThrowError(
      FacetContractError
    )
  })
})
