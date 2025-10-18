// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { PlannerServiceInterface } from '../src/services/planner-service'
import { FlexPlanner, PlannerDraftRejectedError } from '../src/services/flex-planner'

const ACTIVE_CAPABILITY = {
  capabilityId: 'ContentCapability',
  status: 'active' as const,
  version: '1.0.0',
  displayName: 'Content Capability',
  summary: 'Generates copy',
  inputContract: { mode: 'facets' as const, facets: ['objectiveBrief'] },
  outputContract: { mode: 'facets' as const, facets: ['copyVariants'] },
  inputFacets: ['objectiveBrief'],
  outputFacets: ['copyVariants'],
  metadata: { scenarios: ['default'] },
  inputTraits: {},
  cost: {},
  heartbeat: {}
}

function buildPlanner(plannerService: PlannerServiceInterface) {
  const capabilityRegistry = {
    async getSnapshot() {
      return { active: [ACTIVE_CAPABILITY], all: [ACTIVE_CAPABILITY] }
    }
  }

  return new FlexPlanner(
    {
      capabilityRegistry: capabilityRegistry as any,
      plannerService
    },
    {
      now: () => new Date('2025-04-01T12:00:00.000Z')
    }
  )
}

const envelope = {
  objective: 'Create copy variants',
  inputs: {
    objectiveBrief: 'Describe the new product launch.'
  },
  policies: {
    maxTokens: 400,
    replanAfter: ['generation']
  },
  outputContract: {
    mode: 'json_schema' as const,
    schema: {
      type: 'object'
    }
  }
} as const

describe('FlexPlanner hybrid handshake', () => {
  it('invokes onRequest with normalized policies and capability metadata', async () => {
    const plannerService: PlannerServiceInterface = {
      async proposePlan() {
        return {
          nodes: [
            {
              stage: 'generation',
              kind: 'execution',
              capabilityId: ACTIVE_CAPABILITY.capabilityId,
              inputFacets: ['objectiveBrief'],
              outputFacets: ['copyVariants'],
              rationale: ['initial_plan']
            }
          ],
          metadata: {
            provider: 'stub',
            model: 'stub-1.0'
          }
        }
      }
    }

    const planner = buildPlanner(plannerService)
    const invoked: any[] = []

    const plan = await planner.buildPlan('run_test', envelope as any, {
      onRequest: (context) => invoked.push(context)
    })

    expect(invoked).toHaveLength(1)
    const [context] = invoked
    expect(context.runId).toBe('run_test')
    expect(context.policies).toMatchObject(envelope.policies)
    expect(context.capabilities).toHaveLength(1)
    expect(context.capabilities[0].capabilityId).toBe(ACTIVE_CAPABILITY.capabilityId)
    expect(plan.nodes.length).toBeGreaterThanOrEqual(1)
    expect(plan.nodes[0]?.capabilityId).toBe(ACTIVE_CAPABILITY.capabilityId)
    expect(plan.metadata.normalizedPolicyKeys).toContain('maxTokens')
  })

  it('throws PlannerDraftRejectedError with diagnostics when draft references missing capability', async () => {
    const plannerService: PlannerServiceInterface = {
      async proposePlan() {
        return {
          nodes: [
            {
              stage: 'generation',
              kind: 'execution',
              capabilityId: 'unknown_capability',
              inputFacets: ['objectiveBrief'],
              outputFacets: ['copyVariants']
            }
          ]
        }
      }
    }

    const planner = buildPlanner(plannerService)

    let caught: unknown
    await expect(async () => {
      try {
        await planner.buildPlan('run_invalid', envelope as any)
      } catch (error) {
        caught = error
        throw error
      }
    }).rejects.toThrowError(PlannerDraftRejectedError)

    expect(caught).toBeInstanceOf(PlannerDraftRejectedError)
    if (caught instanceof PlannerDraftRejectedError) {
      expect(caught.diagnostics[0]?.code).toBe('CAPABILITY_NOT_REGISTERED')
    }
  })
})
