import { describe, it, expect } from 'vitest'
import type { CapabilityRecord } from '@awesomeposter/shared'
import { FlexCapabilityRegistryService } from '../src/services/flex-capability-registry'
import type { FlexCapabilityRepository, FlexCapabilityRow } from '../src/services/flex-capability-repository'

class StubCapabilityRepository implements FlexCapabilityRepository {
  constructor(private readonly rows: FlexCapabilityRow[]) {}
  async upsert(): Promise<void> {
    throw new Error('not implemented')
  }
  async list(): Promise<FlexCapabilityRow[]> {
    return this.rows
  }
  async markInactive(): Promise<void> {}
}

const now = new Date()

function buildRow(overrides: Partial<FlexCapabilityRow>): FlexCapabilityRow {
  return {
    capabilityId: 'writer.unit',
    version: '1.0.0',
    displayName: 'Writer',
    summary: 'Test capability',
    agentType: 'ai',
    inputTraits: null,
    inputContract: null,
    outputContract: null,
    inputFacets: [],
    outputFacets: [],
    cost: null,
    preferredModels: [],
    heartbeat: null,
    instructionTemplates: null,
    assignmentDefaults: null,
    metadata: null,
    status: 'active',
    lastSeenAt: now,
    registeredAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides
  }
}

describe('FlexCapabilityRegistryService.computeCrcsSnapshot', () => {
  it('prioritizes MRCS rows and annotates reason codes from policies and goal conditions', async () => {
    const rows = [
      buildRow({
        capabilityId: 'writer.primary',
        displayName: 'Writer',
        inputFacets: ['creative_brief'],
        outputFacets: ['final_copy']
      }),
      buildRow({
        capabilityId: 'validator.qa',
        displayName: 'Validator',
        inputFacets: ['final_copy'],
        outputFacets: ['feedback'],
        metadata: { preconditions: ['final_copy'] }
      }),
      buildRow({
        capabilityId: 'policy.pinned',
        displayName: 'Policy Pinned',
        inputFacets: [],
        outputFacets: ['diagnostics']
      })
    ]

    const service = new FlexCapabilityRegistryService(new StubCapabilityRepository(rows))
    const activeCapabilities = (await service.getSnapshot()).active
    const snapshot = await service.computeCrcsSnapshot({
      envelope: {
        objective: 'Test run',
        inputs: { creative_brief: { summary: 'test' } },
        outputContract: { mode: 'facets', facets: ['final_copy'] },
        goal_condition: [
          {
            facet: 'feedback',
            path: '/value',
            condition: { dsl: 'value == "ok"' }
          }
        ]
      } as any,
      policies: {
        planner: {
          selection: {
            require: ['policy.pinned']
          }
        },
        runtime: []
      },
      goalConditionFailures: [],
      capabilities: activeCapabilities,
      graphContext: undefined,
      goalConditions: [
        {
          facet: 'feedback',
          path: '/value',
          condition: { dsl: 'value == "ok"' }
        }
      ]
    })

    expect(snapshot.rows[0]?.capabilityId).toBe('writer.primary')
    expect(snapshot.rows[0]?.reasonCodes).toContain('path')
    const validatorRow = snapshot.rows.find((row) => row.capabilityId === 'validator.qa')
    expect(validatorRow?.reasonCodes).toEqual(expect.arrayContaining(['path', 'goal_condition']))
    const policyRow = snapshot.rows.find((row) => row.capabilityId === 'policy.pinned')
    expect(policyRow).toBeUndefined()
    expect(snapshot.missingPinnedCapabilityIds).toContain('policy.pinned')
    expect(snapshot.reasonCounts.path).toBeGreaterThanOrEqual(1)
    expect(snapshot.reasonCounts.goal_condition).toBeGreaterThanOrEqual(1)
  })

  it('records missing pinned capability facets when no provider exists', async () => {
    const rows = [
      buildRow({
        capabilityId: 'writer.primary',
        displayName: 'Writer',
        inputFacets: [],
        outputFacets: ['final_copy']
      })
    ]
    const service = new FlexCapabilityRegistryService(new StubCapabilityRepository(rows))
    const activeCapabilities = (await service.getSnapshot()).active
    const snapshot = await service.computeCrcsSnapshot({
      envelope: {
        objective: 'Test run',
        outputContract: { mode: 'facets', facets: ['final_copy'] },
        goal_condition: [
          {
            facet: 'nonexistent_facet',
            path: '/status',
            condition: { dsl: 'status == "ready"' }
          }
        ]
      } as any,
      policies: { runtime: [], planner: undefined },
      capabilities: activeCapabilities,
      graphContext: undefined,
      goalConditions: [
        {
          facet: 'nonexistent_facet',
          path: '/status',
          condition: { dsl: 'status == \"ready\"' }
        }
      ]
    })
    expect(snapshot.missingPinnedCapabilityIds).toContain('facet:nonexistent_facet')
  })
})
