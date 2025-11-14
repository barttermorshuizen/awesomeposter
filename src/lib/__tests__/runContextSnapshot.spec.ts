import { describe, it, expect } from 'vitest'
import { collectRunContextFacetEntries, getRunContextFacetValue } from '@/lib/runContextSnapshot'

describe('runContextSnapshot helpers', () => {
  it('reads legacy facet bag entries', () => {
    const snapshot = {
      facets: {
        post: { value: { copy: 'Legacy value' } }
      },
      hitlClarifications: []
    }

    expect(getRunContextFacetValue(snapshot, 'post')).toEqual({ copy: 'Legacy value' })
  })

  it('reads flattened snapshot entries while ignoring metadata keys', () => {
    const snapshot = {
      post: {
        value: { copy: 'Flattened entry' },
        updatedAt: '2025-11-13T15:57:59.020Z'
      },
      feedback: {
        value: [{ facet: 'post_copy', message: 'Needs CTA' }],
        updatedAt: '2025-11-13T15:58:00.000Z'
      },
      expectedOutputFacets: ['post', 'feedback'],
      hitlClarifications: []
    }

    const entries = collectRunContextFacetEntries(snapshot)
    expect(Object.keys(entries)).toContain('post')
    expect(Object.keys(entries)).toContain('feedback')
    expect(entries.feedback.value).toEqual([{ facet: 'post_copy', message: 'Needs CTA' }])
    expect(getRunContextFacetValue(snapshot, 'feedback')).toEqual([{ facet: 'post_copy', message: 'Needs CTA' }])
  })
})
