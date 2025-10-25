// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { TaskEnvelope } from '@awesomeposter/shared'

vi.mock('../src/services/agents-container', () => ({
  getAgents: () => ({ runtime: { runStructured: vi.fn() } })
}))

vi.mock('../src/services/flex-capability-registry', () => ({
  getFlexCapabilityRegistryService: () => ({
    refresh: vi.fn(),
    getCapabilityById: vi.fn(() => null)
  })
}))

import { FlexExecutionEngine } from '../src/services/flex-execution-engine'

describe('FlexExecutionEngine HITL prompt enrichment', () => {
  it('produces operator guidance and contract summary for pending nodes', () => {
    const engine = new FlexExecutionEngine({} as any)

    const envelope: TaskEnvelope = {
      objective: 'Draft a launch plan summary',
      inputs: {},
      policies: {},
      specialInstructions: [],
      outputContract: {
        mode: 'freeform',
        instructions: 'Return an approval summary.'
      }
    }

    const finalOutput = { copyVariants: [{ text: 'Placeholder copy' }] }
    const plan = {
      runId: 'run_demo',
      version: 4,
      createdAt: new Date().toISOString(),
      nodes: [],
      edges: [],
      metadata: {}
    }

    const node = {
      id: 'qa_node_1',
      label: 'QA Approval',
      capabilityId: 'QualityAssuranceAgent.contentReview',
      capabilityLabel: 'Quality Assurance',
      contracts: {
        output: {
          mode: 'freeform',
          instructions: 'Return approval status and findings.'
        }
      },
      facets: {
        input: [],
        output: ['qaFindings']
      },
      provenance: {
        output: [
          {
            facet: 'qaFindings',
            title: 'QA Findings',
            direction: 'output',
            pointer: '/qaFindings'
          }
        ]
      },
      bundle: {},
      rationale: [],
      metadata: {}
    }

    const details = (engine as any).buildHitlRequestDetails(envelope, finalOutput, {
      question: 'Manual QA approval required',
      policyId: 'qa_hitl_gate',
      nodeLabel: node.label,
      plan,
      node
    })

    expect(details.payload.question).toBe('Manual QA approval required')
    expect(details.payload.additionalContext).toContain('Objective: Draft a launch plan summary')
    expect(details.operatorPrompt).toContain('Plan v4')
    expect(details.operatorPrompt).toContain('Quality Assurance')
    expect(details.contractSummary?.nodeId).toBe('qa_node_1')
    expect(details.contractSummary?.contract?.output?.mode).toBe('freeform')
    expect(details.contractSummary?.facets?.output?.[0]?.facet).toBe('qaFindings')
  })
})
