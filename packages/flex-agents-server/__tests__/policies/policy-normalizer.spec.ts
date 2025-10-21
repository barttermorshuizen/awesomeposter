import { describe, expect, it } from 'vitest'

import type { TaskEnvelope } from '@awesomeposter/shared'
import { PolicyNormalizer } from '../../src/services/policy-normalizer'

const OUTPUT_CONTRACT: TaskEnvelope['outputContract'] = {
  mode: 'json_schema',
  schema: {
    type: 'object',
    additionalProperties: true
  }
}

describe('PolicyNormalizer', () => {
  it('returns canonical policies unchanged', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'canonical',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        planner: {
          optimisation: {
            objective: 'quality'
          }
        },
        runtime: [
          {
            id: 'hitl_on_timeout',
            trigger: { kind: 'onTimeout', ms: 5000 },
            action: { type: 'hitl', rationale: 'Manual review required' }
          }
        ]
      }
    }

    const result = normalizer.normalize(envelope)
    expect(result.canonical.runtime).toHaveLength(1)
    expect(result.canonical.planner?.optimisation?.objective).toBe('quality')
    expect(result.legacyNotes).toHaveLength(0)
  })

  it('converts legacy directives into canonical runtime policies and planner topology', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'legacy',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        variantCount: 3,
        replanAfter: ['qa'],
        triggerReplanAfter: [{ capabilityId: 'content.generator', reason: 'qa_feedback' }]
      } as any
    }

    const result = normalizer.normalize(envelope)
    expect(result.canonical.planner?.topology?.variantCount).toBe(3)
    expect(result.runtime).toHaveLength(2)
    const [stagePolicy, capabilityPolicy] = result.runtime
    expect(stagePolicy.action.type).toBe('replan')
    expect(stagePolicy.trigger.kind).toBe('onNodeComplete')
    expect(capabilityPolicy.trigger.kind).toBe('onNodeComplete')
    expect(capabilityPolicy.trigger.selector?.capabilityId).toBe('content.generator')
    expect(result.legacyNotes.some((note) => note.includes('legacy replan directives'))).toBe(true)
  })

  it('evaluates stage-mapped runtime policies for replanning', () => {
    const normalizer = new PolicyNormalizer()
    const runtimeEnvelope: TaskEnvelope = {
      objective: 'stage-policy',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'stage_replan',
            trigger: { kind: 'onNodeComplete', selector: undefined, condition: { '==': [{ var: 'metadata.plannerStage' }, 'qa'] } },
            action: { type: 'replan', rationale: 'QA findings require replanning' }
          }
        ]
      }
    }

    const normalized = normalizer.normalize(runtimeEnvelope)
    const effect = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'node-qa',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Evaluation',
      bundle: { runId: 'run', nodeId: 'node-qa', objective: 'stage-policy', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: { plannerStage: 'qa' }
    } as any)

    expect(effect?.kind).toBe('replan')
    expect(effect && effect.kind === 'replan' ? effect.trigger.reason : undefined).toBe('policy_runtime_replan')
    expect(effect && effect.kind === 'replan' ? effect.trigger.details?.policyId : undefined).toBe('stage_replan')
  })

  it('returns action effect for hitl runtime policies', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'runtime-hitl',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'qa_hitl_gate',
            trigger: { kind: 'onNodeComplete', selector: { capabilityId: 'qa.agent' } },
            action: { type: 'hitl', rationale: 'Manual QA approval required' }
          }
        ]
      }
    }

    const normalized = normalizer.normalize(envelope)
    const effect = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'qa-node',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Validation',
      bundle: { runId: 'run', nodeId: 'qa-node', objective: 'runtime-hitl', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {}
    } as any)

    expect(effect?.kind).toBe('action')
    expect(effect && effect.kind === 'action' ? effect.policy.action.type : undefined).toBe('hitl')
  })
})
