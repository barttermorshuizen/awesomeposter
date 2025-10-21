import { describe, expect, it } from 'vitest'
import {
  buildVariableLookup,
  createMockCatalog,
  playgroundSamples,
  playgroundVariables,
} from '../conditionPlayground/catalog'

describe('condition playground catalog helpers', () => {
  it('creates a mock catalog compatible with shared transpiler utilities', () => {
    const catalog = createMockCatalog()
    expect(catalog.variables).toHaveLength(playgroundVariables.length)
    const first = catalog.variables[0]
    expect(first).toMatchObject({
      id: playgroundVariables[0].id,
      path: playgroundVariables[0].path,
    })
  })

  it('builds a lookup map keyed by variable path', () => {
    const lookup = buildVariableLookup()
    for (const variable of playgroundVariables) {
      expect(lookup.get(variable.id)).toBe(variable)
    }
  })

  it('exposes sample payloads for preview evaluation', () => {
    expect(playgroundSamples.length).toBeGreaterThan(0)
    for (const sample of playgroundSamples) {
      expect(typeof sample.id).toBe('string')
      expect(sample.payload).toBeTruthy()
    }
  })
})
