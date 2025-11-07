import { describe, expect, it } from 'vitest'

import { TaskEnvelopeSchema } from '../../src/flex/types.js'

const baseEnvelope = {
  objective: 'Deliver the quarterly positioning update',
  outputContract: {
    mode: 'freeform',
    instructions: 'Draft a concise summary for executive review.'
  }
}

describe('TaskEnvelopeSchema goal_condition', () => {
  it('accepts envelopes without goal_condition', () => {
    expect(() => TaskEnvelopeSchema.parse({ ...baseEnvelope })).not.toThrow()
  })

  it('accepts a single facet condition', () => {
    const result = TaskEnvelopeSchema.parse({
      ...baseEnvelope,
      goal_condition: [
        {
          facet: 'handoff_summary',
          path: '/status',
          condition: {
            dsl: 'status == "ready"'
          }
        }
      ]
    })

    expect(result.goal_condition).toHaveLength(1)
  })

  it('accepts multiple facet conditions', () => {
    const result = TaskEnvelopeSchema.parse({
      ...baseEnvelope,
      goal_condition: [
        {
          facet: 'post_copy',
          path: '/variants[0]/quality_score',
          condition: {
            dsl: 'quality_score >= 0.85'
          }
        },
        {
          facet: 'post_visual',
          path: '/asset/status',
          condition: {
            dsl: 'status == "approved"'
          }
        }
      ]
    })

    expect(result.goal_condition).toHaveLength(2)
  })

  it('rejects facet conditions missing required keys', () => {
    expect(() =>
      TaskEnvelopeSchema.parse({
        ...baseEnvelope,
        goal_condition: [
          {
            facet: 'post_copy',
            condition: {
              dsl: 'quality_score >= 0.85'
            }
          }
        ]
      })
    ).toThrow()
  })

  it('rejects facet conditions with unknown properties', () => {
    expect(() =>
      TaskEnvelopeSchema.parse({
        ...baseEnvelope,
        goal_condition: [
          {
            facet: 'post_copy',
            path: '/variants[0]/quality_score',
            condition: {
              dsl: 'quality_score >= 0.85'
            },
            unexpected: true
          } as any
        ]
      })
    ).toThrow()
  })

  it('rejects empty goal_condition arrays', () => {
    expect(() =>
      TaskEnvelopeSchema.parse({
        ...baseEnvelope,
        goal_condition: []
      })
    ).toThrow()
  })
})
