import { describe, it, expect } from 'vitest'
import { appendHistoryEntry, extractPlanPayload } from '../flexSandboxPlan'

describe('flexSandboxPlan utils', () => {
  it('extracts plan data from nested plan payload', () => {
    const payload = {
      plan: {
        runId: 'run-1',
        version: 1,
        metadata: {
          plannerContext: { channel: 'initial', formats: ['initial'], languages: [], audiences: [], tags: [], specialInstructions: [] },
          variantCount: 1
        },
        nodes: [
          { id: 'node-1', capabilityId: 'writer.v1', label: 'Writer', status: 'running' },
          { id: 'node-2', capabilityId: 'qa.v1', label: 'QA', status: 'pending' }
        ]
      }
    }

    const result = extractPlanPayload(payload)
    expect(result?.runId).toBe('run-1')
    expect(result?.version).toBe(1)
    expect(result?.metadata).toEqual({
      plannerContext: { channel: 'initial', formats: ['initial'], languages: [], audiences: [], tags: [], specialInstructions: [] },
      variantCount: 1
    })
    expect(result?.nodes).toHaveLength(2)
    expect(result?.nodes[0]).toMatchObject({ id: 'node-1', status: 'running' })
  })

  it('extracts plan data from top-level plan payload', () => {
    const payload = {
      runId: 'run-2',
      version: 2,
      trigger: { reason: 'policy_triggered' },
      nodes: [
        { id: 'node-1', capabilityId: 'writer.v1', label: 'Writer', status: 'completed' },
        { id: 'node-3', capabilityId: 'editor.v1', label: 'Editor', status: 'pending' }
      ],
      metadata: {
        plannerContext: { channel: 'replan', formats: ['replan'], languages: [], audiences: [], tags: [], specialInstructions: [] },
        variantCount: 1
      }
    }

    const result = extractPlanPayload(payload)
    expect(result?.runId).toBe('run-2')
    expect(result?.version).toBe(2)
    expect(result?.nodes).toHaveLength(2)
    const editor = result?.nodes.find((node) => node.id === 'node-3')
    expect(editor).toMatchObject({ label: 'Editor', status: 'pending' })
  })

  it('throws when plan nodes omit status', () => {
    const payload = {
      plan: {
        runId: 'run-3',
        version: 3,
        nodes: [{ id: 'node-1', capabilityId: 'writer.v1', label: 'Writer' }]
      }
    }

    expect(() => extractPlanPayload(payload)).toThrow(/status/i)
  })

  it('throws when plan version is missing', () => {
    const payload = {
      plan: {
        nodes: [{ id: 'node-1', capabilityId: 'writer.v1', label: 'Writer', status: 'pending' }]
      }
    }

    expect(() => extractPlanPayload(payload)).toThrow(/version/i)
  })

  it('appends plan history entries while keeping most recent', () => {
    const initial = appendHistoryEntry([], { version: 1, timestamp: '2024-01-01T00:00:00.000Z', trigger: 'initial' })
    const second = appendHistoryEntry(initial, {
      version: 2,
      timestamp: '2024-01-01T00:01:00.000Z',
      trigger: { reason: 'policy_triggered' }
    })
    const duplicate = appendHistoryEntry(second, {
      version: 2,
      timestamp: '2024-01-01T00:01:00.000Z',
      trigger: { reason: 'policy_triggered' }
    })

    expect(initial).toHaveLength(1)
    expect(second).toHaveLength(2)
    expect(duplicate).toHaveLength(2)
    expect(second[1].trigger).toEqual({ reason: 'policy_triggered' })
  })
})
