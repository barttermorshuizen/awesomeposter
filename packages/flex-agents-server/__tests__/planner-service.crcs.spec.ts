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
    postConditionsDsl: null,
    postConditionMetadata: null,
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

  it('only treats selection.require entries as pinned requirements', async () => {
    const rows = [
      buildRow({
        capabilityId: 'writer.primary',
        displayName: 'Writer',
        inputFacets: ['creative_brief'],
        outputFacets: ['final_copy']
      })
    ]
    const service = new FlexCapabilityRegistryService(new StubCapabilityRepository(rows))
    const activeCapabilities = (await service.getSnapshot()).active
    const snapshot = await service.computeCrcsSnapshot({
      envelope: {
        objective: 'Test run',
        inputs: { creative_brief: { summary: 'test' } },
        outputContract: { mode: 'facets', facets: ['final_copy'] }
      } as any,
      policies: {
        planner: {
          selection: {
            require: ['policy.required'],
            avoid: ['policy.avoid'],
            forbid: ['policy.forbid']
          }
        },
        runtime: []
      },
      capabilities: activeCapabilities,
      graphContext: undefined
    })
    expect(snapshot.missingPinnedCapabilityIds).toContain('policy.required')
    expect(snapshot.missingPinnedCapabilityIds).not.toContain('policy.avoid')
    expect(snapshot.missingPinnedCapabilityIds).not.toContain('policy.forbid')
  })

  it('excludes multi-input capabilities until all required input facets are reachable', async () => {
    const rows = [
      buildRow({
        capabilityId: 'writer.single_input',
        displayName: 'Single Input Writer',
        inputFacets: ['post_context'],
        outputFacets: ['post_copy']
      }),
      buildRow({
        capabilityId: 'writer.multi_input',
        displayName: 'Multi Input Writer',
        inputFacets: ['post_context', 'company_information'],
        outputFacets: ['post_copy']
      })
    ]
    const service = new FlexCapabilityRegistryService(new StubCapabilityRepository(rows))
    const activeCapabilities = (await service.getSnapshot()).active
    const snapshot = await service.computeCrcsSnapshot({
      envelope: {
        objective: 'Announce new hire',
        inputs: {
          post_context: {
            summary: 'Introductory copy'
          }
        },
        outputContract: { mode: 'facets', facets: ['post_copy'] }
      } as any,
      policies: { runtime: [], planner: undefined },
      capabilities: activeCapabilities,
      graphContext: undefined
    })
    const capabilityIds = snapshot.rows.map((row) => row.capabilityId)
    expect(capabilityIds).toContain('writer.single_input')
    expect(capabilityIds).not.toContain('writer.multi_input')
  })

  it('includes post-condition summaries in CRCS rows', async () => {
    const rows = [
      buildRow({
        capabilityId: 'writer.conditions',
        displayName: 'Writer With Conditions',
        inputFacets: ['brief'],
        outputFacets: ['final_copy'],
        postConditionMetadata: {
          conditions: [
            {
              facet: 'final_copy',
              path: '/status',
              condition: {
                dsl: 'status == "ready"',
                canonicalDsl: 'status == "ready"',
                jsonLogic: { '==': [{ var: 'status' }, 'ready'] }
              }
            }
          ],
          guards: [{ facet: 'final_copy', paths: ['/status'] }]
        }
      })
    ]
    const service = new FlexCapabilityRegistryService(new StubCapabilityRepository(rows))
    const activeCapabilities = (await service.getSnapshot()).active
    const snapshot = await service.computeCrcsSnapshot({
      envelope: {
        objective: 'Test',
        inputs: { brief: { summary: 'test' } },
        outputContract: { mode: 'facets', facets: ['final_copy'] }
      } as any,
      policies: { runtime: [], planner: undefined },
      capabilities: activeCapabilities
    })
    expect(snapshot.rows[0]?.postConditions).toEqual([
      { facet: 'final_copy', path: '/status', expression: 'status == "ready"' }
    ])
  })
})
