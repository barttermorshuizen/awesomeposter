import { describe, it, expect, vi } from 'vitest'
import type { CapabilityRecord, TaskEnvelope } from '@awesomeposter/shared'
import { FlexPlanner, MissingPinnedCapabilitiesError } from '../src/services/flex-planner'

const baseCapability: CapabilityRecord = {
  capabilityId: 'writer.primary',
  version: '1.0.0',
  displayName: 'Writer',
  summary: 'Writes copy',
  agentType: 'ai',
  inputContract: { mode: 'facets', facets: ['brief'] },
  outputContract: { mode: 'facets', facets: ['final_copy'] },
  inputFacets: ['brief'],
  outputFacets: ['final_copy'],
  metadata: {},
  status: 'active',
  registeredAt: '2025-01-01T00:00:00.000Z',
  lastSeenAt: '2025-01-01T00:00:00.000Z'
}

describe('FlexPlanner CRCS enforcement', () => {
  it('throws when pinned capabilities are missing from CRCS', async () => {
    const capabilityRegistry = {
      getSnapshot: vi.fn().mockResolvedValue({ active: [baseCapability], all: [baseCapability] }),
      computeCrcsSnapshot: vi.fn().mockResolvedValue({
        rows: [],
        totalRows: 0,
        mrcsSize: 0,
        reasonCounts: {},
        rowCap: 40,
        truncated: false,
        pinnedCapabilityIds: [],
        mrcsCapabilityIds: [],
        missingPinnedCapabilityIds: ['policy.required']
      })
    }
    const plannerService = {
      proposePlan: vi.fn()
    }
    const validationService = {
      validate: vi.fn().mockReturnValue({ ok: true, diagnostics: [] })
    }

    const planner = new FlexPlanner(
      {
        capabilityRegistry: capabilityRegistry as any,
        plannerService: plannerService as any,
        validationService: validationService as any
      },
      { now: () => new Date('2025-01-01T00:00:00.000Z') }
    )

    const envelope = {
      objective: 'Test run',
      inputs: { brief: { summary: 'test' } },
      outputContract: { mode: 'facets', facets: ['final_copy'] },
      policies: {}
    } as TaskEnvelope

    await expect(planner.buildPlan('run-123', envelope)).rejects.toBeInstanceOf(MissingPinnedCapabilitiesError)
    expect(plannerService.proposePlan).not.toHaveBeenCalled()
  })
})
