import { describe, it, expect } from 'vitest'
import type { FacetCondition } from '@awesomeposter/shared'
import type { RunContextSnapshot } from '../src/services/run-context'
import { evaluateGoalConditions } from '../src/services/goal-condition-evaluator'

const baseSnapshot: RunContextSnapshot = {
  facets: {
    post_copy: {
      value: {
        variants: [
          {
            quality_score: 0.92,
            status: 'ready'
          }
        ]
      },
      updatedAt: '2025-01-01T00:00:00Z',
      provenance: []
    },
    post_visual: {
      value: {
        asset: {
          status: 'pending'
        }
      },
      updatedAt: '2025-01-01T00:00:00Z',
      provenance: []
    }
  },
  hitlClarifications: []
}

describe('evaluateGoalConditions', () => {
  it('marks predicates satisfied when the facet snippet matches', () => {
    const conditions: FacetCondition[] = [
      {
        facet: 'post_copy',
        path: '/variants[0]',
        condition: {
          dsl: 'quality_score >= 0.8',
          canonicalDsl: 'quality_score >= 0.8',
          jsonLogic: {
            '>=': [{ var: 'quality_score' }, 0.8]
          }
        }
      }
    ]

    const results = evaluateGoalConditions(conditions, { runContextSnapshot: baseSnapshot })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      facet: 'post_copy',
      path: '/variants[0]',
      expression: 'quality_score >= 0.8',
      satisfied: true
    })
    expect(results[0].error).toBeUndefined()
  })

  it('marks predicates as failed when the expression returns false', () => {
    const conditions: FacetCondition[] = [
      {
        facet: 'post_visual',
        path: '/asset/status',
        condition: {
          dsl: 'status == "approved"',
          canonicalDsl: 'status == "approved"',
          jsonLogic: {
            '==': [{ var: 'status' }, 'approved']
          }
        }
      }
    ]

    const results = evaluateGoalConditions(conditions, { runContextSnapshot: baseSnapshot })
    expect(results[0]?.satisfied).toBe(false)
    expect(results[0]?.error).toBeUndefined()
  })

  it('records an error when the facet path cannot be resolved', () => {
    const conditions: FacetCondition[] = [
      {
        facet: 'post_visual',
        path: '/asset/missingField',
        condition: {
          dsl: 'missingField == "anything"',
          canonicalDsl: 'missingField == "anything"',
          jsonLogic: {
            '==': [{ var: 'missingField' }, 'anything']
          }
        }
      }
    ]

    const results = evaluateGoalConditions(conditions, { runContextSnapshot: baseSnapshot })
    expect(results[0]?.satisfied).toBe(false)
    expect(results[0]?.error).toContain('did not resolve')
  })
})
