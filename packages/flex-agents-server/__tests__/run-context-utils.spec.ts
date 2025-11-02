import { describe, expect, it } from 'vitest'
import {
  mergeFacetValuesIntoStructure,
  stripPlannerFields
} from '../src/services/run-context-utils'

describe('run-context-utils', () => {
  it('merges facet values using provenance pointers', () => {
    const base = { artifacts: { post_visual: [] as Array<{ url: string }> } }
    const additions = {
      post_visual: [{ url: 'https://example.com/post.png' }]
    }
    const provenance = [
      {
        facet: 'post_visual',
        pointer: '/artifacts/post_visual'
      }
    ]

    const result = mergeFacetValuesIntoStructure(base, additions, provenance)

    expect(result.artifacts?.post_visual).toEqual(additions.post_visual)
  })

  it('drops planner-only metadata when stripping fields', () => {
    const payload = {
      plannerKind: 'execution',
      data: { foo: 'bar' },
      derivedCapability: true
    }

    expect(stripPlannerFields(payload)).toEqual({ data: { foo: 'bar' } })
  })
})
