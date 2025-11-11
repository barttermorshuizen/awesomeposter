import { describe, it, expect } from 'vitest'

import {
  compileRoutingCondition,
  compileRoutingEdge,
  compileConditionalRoutingNode
} from '../../src/flex/routing'

describe('flex routing helpers', () => {
  it('compiles DSL expressions to routing conditions', () => {
    const condition = compileRoutingCondition('facets.toneOfVoice == "playful"')
    expect(condition.dsl).toBe('facets.toneOfVoice == "playful"')
    expect(condition.canonicalDsl).toBeTruthy()
    expect(condition.jsonLogic).toBeTruthy()
  })

  it('compiles routing edges with metadata', () => {
    const edge = compileRoutingEdge({
      to: 'node-b',
      condition: {
        dsl: 'metadata.mock == true',
        jsonLogic: { '==': [{ var: 'metadata.mock' }, true] },
        canonicalDsl: 'metadata.mock == true',
        warnings: [],
        variables: ['metadata.mock']
      },
      label: 'has findings'
    })

    expect(edge.to).toBe('node-b')
    expect(edge.condition.variables).toEqual(expect.arrayContaining(['metadata.mock']))
    expect(edge.label).toBe('has findings')
  })

  it('compiles routing nodes with else branch', () => {
    const node = compileConditionalRoutingNode({
      routes: [
        {
          to: 'node-b',
          condition: {
            dsl: 'metadata.score >= 0.7',
            jsonLogic: { '>=': [{ var: 'metadata.score' }, 0.7] },
            canonicalDsl: 'metadata.score >= 0.7',
            warnings: [],
            variables: ['metadata.score']
          }
        }
      ],
      elseTo: 'node-c'
    })

    expect(node.routes).toHaveLength(1)
    expect(node.routes[0].to).toBe('node-b')
    expect(node.elseTo).toBe('node-c')
  })
})
