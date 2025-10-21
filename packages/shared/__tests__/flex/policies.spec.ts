import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  ActionSchema,
  NodeSelectorSchema,
  PlannerPolicySchema,
  PolicyTriggerSchema,
  RuntimePolicySchema,
  TaskPoliciesSchema,
  parseTaskPolicies,
  type Action,
  type NodeSelector,
  type PlannerPolicy,
  type PolicyTrigger,
  type RuntimePolicy,
  type TaskPolicies
} from '../../src/flex/policies.js'

describe('TaskPolicies schema', () => {
  it('parses minimal structures with defaults', () => {
    const result = parseTaskPolicies({})
    expect(result.planner).toBeUndefined()
    expect(result.runtime).toEqual([])
  })

  it('applies defaults and dedupes planner selection arrays', () => {
    const parsed = parseTaskPolicies({
      planner: {
        selection: {
          require: ['capability.a', 'capability.a', 'capability.b'],
          prefer: ['capability.b']
        }
      }
    })

    expect(parsed.planner?.selection?.require).toEqual(['capability.a', 'capability.b'])
    expect(parsed.planner?.selection?.prefer).toEqual(['capability.b'])
  })

  it('normalizes runtime policy enablement and validates selectors', () => {
    const parsed = parseTaskPolicies({
      runtime: [
        {
          id: 'policy-1',
          trigger: { kind: 'onStart' },
          action: { type: 'replan' }
        },
        {
          id: 'policy-2',
          enabled: false,
          trigger: { kind: 'onTimeout', ms: 5000 },
          action: { type: 'pause', reason: 'slow' }
        }
      ]
    })

    expect(parsed.runtime[0].enabled).toBe(true)
    expect(parsed.runtime[1].enabled).toBe(false)
  })

  it('parses each trigger and action variant', () => {
    const parsed = parseTaskPolicies({
      runtime: [
        { id: 'goto', trigger: { kind: 'onStart' }, action: { type: 'goto', next: 'node-2', maxAttempts: 2 } },
        {
          id: 'validation-hitl',
          trigger: { kind: 'onValidationFail', selector: { kind: 'qa' } },
          action: {
            type: 'hitl',
            rationale: 'manual QA approval',
            approveAction: { type: 'emit', event: 'qa_approved' },
            rejectAction: { type: 'fail', message: 'qa_rejected' }
          }
        },
        {
          id: 'metric-fail',
          trigger: { kind: 'onMetricBelow', metric: 'quality', threshold: 0.6 },
          action: { type: 'fail', message: 'quality too low' }
        },
        {
          id: 'manual-emit',
          trigger: { kind: 'manual' },
          action: { type: 'emit', event: 'manual_signal', payload: { note: 'manual override' } }
        },
        {
          id: 'timeout-pause',
          trigger: { kind: 'onTimeout', ms: 15000 },
          action: { type: 'pause', reason: 'awaiting review' }
        }
      ]
    })

    const actionTypes = parsed.runtime.map((policy) => policy.action.type)
    expect(actionTypes).toEqual(['goto', 'hitl', 'fail', 'emit', 'pause'])
    const hitlPolicy = parsed.runtime.find((policy) => policy.id === 'validation-hitl')
    expect(hitlPolicy?.action).toMatchObject({
      approveAction: { type: 'emit', event: 'qa_approved' },
      rejectAction: { type: 'fail', message: 'qa_rejected' }
    })
  })

  it('rejects legacy action names with helpful error', () => {
    expect(() =>
      parseTaskPolicies({
        runtime: [
          {
            id: 'legacy-hitl',
            trigger: { kind: 'manual' },
            action: { type: 'hitl_pause' } as any
          }
        ]
      })
    ).toThrowError(/Legacy runtime policy action \\"hitl_pause\\" detected/)
  })

  it('rejects unknown action names with supported list', () => {
    expect(() =>
      parseTaskPolicies({
        runtime: [
          {
            id: 'unknown-action',
            trigger: { kind: 'manual' },
            action: { type: 'teleport' } as any
          }
        ]
      })
    ).toThrowError(/Unknown runtime policy action \\"teleport\\"/)
  })

  it('enforces goto actions to specify a next node', () => {
    expect(() =>
      ActionSchema.parse({
        type: 'goto'
      })
    ).toThrowError(/Required/)
  })

  it('maintains exhaustive type coverage', () => {
    expectTypeOf<NodeSelector>().toEqualTypeOf<ReturnType<typeof NodeSelectorSchema.parse>>()
    expectTypeOf<PolicyTrigger>().toEqualTypeOf<ReturnType<typeof PolicyTriggerSchema.parse>>()
    expectTypeOf<Action>().toEqualTypeOf<ReturnType<typeof ActionSchema.parse>>()
    expectTypeOf<RuntimePolicy>().toEqualTypeOf<ReturnType<typeof RuntimePolicySchema.parse>>()
    expectTypeOf<PlannerPolicy>().toEqualTypeOf<ReturnType<typeof PlannerPolicySchema.parse>>()
    expectTypeOf<TaskPolicies>().toEqualTypeOf<ReturnType<typeof TaskPoliciesSchema.parse>>()
  })
})
