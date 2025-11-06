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

  it('compiles DSL-backed runtime conditions into canonical metadata', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'dsl-condition',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'quality-threshold',
            trigger: {
              kind: 'onNodeComplete',
              condition: {
                dsl: 'facets.planKnobs.hookIntensity < 0.6'
              }
            },
            action: { type: 'replan', rationale: 'Low QA score requires replanning' }
          }
        ]
      }
    }

    const result = normalizer.normalize(envelope)
    const policy = result.runtime[0]
    expect(policy.trigger.kind).toBe('onNodeComplete')
    const condition = (policy.trigger as any).condition
    expect(condition?.dsl).toBe('facets.planKnobs.hookIntensity < 0.6')
    expect(condition?.canonicalDsl).toBe('facets.planKnobs.hookIntensity < 0.6')
    expect(condition?.jsonLogic).toEqual({
      '<': [{ var: 'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity' }, 0.6]
    })
    expect(condition?.warnings ?? []).toEqual([])
    expect(condition?.variables).toEqual([
      'metadata.runContextSnapshot.facets.planKnobs.value.hookIntensity'
    ])
  })

  it('evaluates DSL runtime conditions after normalization', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'dsl-evaluation',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'quality-threshold',
            trigger: {
              kind: 'onNodeComplete',
              condition: {
                dsl: 'facets.planKnobs.hookIntensity < 0.6'
              }
            },
            action: { type: 'replan', rationale: 'Replan when QA score is low' }
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
      label: 'QA Review',
      bundle: { runId: 'run', nodeId: 'qa-node', objective: 'dsl-evaluation', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {
        runContextSnapshot: {
          facets: {
            planKnobs: {
              value: {
                hookIntensity: 0.55
              }
            }
          }
        }
      }
    } as any)

    expect(effect?.kind).toBe('replan')
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

  it('evaluates runtime policies using quantifier-based conditions', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'quantifier-policy',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'unresolved_feedback_replan',
            trigger: {
              kind: 'onNodeComplete',
              condition: {
                some: [
                  { var: 'metadata.runContextSnapshot.facets.recommendationSet.value' },
                  { '==': [{ var: 'resolution' }, 'unresolved'] }
                ]
              }
            },
            action: { type: 'replan', rationale: 'Address unresolved QA feedback' }
          }
        ]
      }
    }

    const normalized = normalizer.normalize(envelope)
    const effect = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'qa-review-node',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Review',
      bundle: { runId: 'run', nodeId: 'qa-review-node', objective: 'quantifier-policy', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { id: 'rec-1', resolution: 'resolved' },
                { id: 'rec-2', resolution: 'unresolved' }
              ]
            }
          }
        }
      }
    } as any)

    expect(effect?.kind).toBe('replan')

    const noEffect = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'qa-review-node',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Review',
      bundle: { runId: 'run', nodeId: 'qa-review-node', objective: 'quantifier-policy', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { id: 'rec-1', resolution: 'resolved' },
                { id: 'rec-2', resolution: 'resolved' }
              ]
            }
          }
        }
      }
    } as any)

    expect(noEffect).toBeNull()
  })

  it('evaluates runtime policies using `all` quantifier conditions', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'all-quantifier-policy',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'all_feedback_resolved',
            trigger: {
              kind: 'onNodeComplete',
              condition: {
                all: [
                  { var: 'metadata.runContextSnapshot.facets.recommendationSet.value' },
                  { '==': [{ var: 'resolution' }, 'resolved'] }
                ]
              }
            },
            action: { type: 'replan', rationale: 'Ensure unresolved items are addressed' }
          }
        ]
      }
    }

    const normalized = normalizer.normalize(envelope)
    const effect = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'qa-review-node',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Review',
      bundle: { runId: 'run', nodeId: 'qa-review-node', objective: 'all-quantifier-policy', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { id: 'rec-1', resolution: 'resolved' },
                { id: 'rec-2', resolution: 'resolved' }
              ]
            }
          }
        }
      }
    } as any)

    expect(effect?.kind).toBe('replan')

    const noEffect = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'qa-review-node',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Review',
      bundle: { runId: 'run', nodeId: 'qa-review-node', objective: 'all-quantifier-policy', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: [
                { id: 'rec-1', resolution: 'resolved' },
                { id: 'rec-2', resolution: 'unresolved' }
              ]
            }
          }
        }
      }
    } as any)

    expect(noEffect).toBeNull()

    const emptyArray = normalizer.evaluateRuntimeEffect(normalized, {
      id: 'qa-review-node',
      kind: 'validation',
      capabilityId: 'qa.agent',
      capabilityLabel: 'QA Agent',
      label: 'QA Review',
      bundle: { runId: 'run', nodeId: 'qa-review-node', objective: 'all-quantifier-policy', contract: OUTPUT_CONTRACT } as any,
      contracts: { output: OUTPUT_CONTRACT },
      facets: { input: [], output: [] },
      provenance: {},
      rationale: [],
      metadata: {
        runContextSnapshot: {
          facets: {
            recommendationSet: {
              value: []
            }
          }
        }
      }
    } as any)

    expect(emptyArray).toBeNull()
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

  it('evaluates onStart runtime policies for startup actions', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'runtime-start',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'start_hitl_gate',
            trigger: { kind: 'onStart' },
            action: { type: 'hitl', rationale: 'Operator must approve run before execution' }
          }
        ]
      }
    }

    const normalized = normalizer.normalize(envelope)
    const effect = normalizer.evaluateRunStartEffect(normalized)

    expect(effect?.kind).toBe('action')
    expect(effect && effect.kind === 'action' ? effect.policy.id : undefined).toBe('start_hitl_gate')
  })

  it('evaluates onStart runtime policies for startup replans', () => {
    const normalizer = new PolicyNormalizer()
    const envelope: TaskEnvelope = {
      objective: 'runtime-start-replan',
      inputs: {},
      outputContract: OUTPUT_CONTRACT,
      policies: {
        runtime: [
          {
            id: 'start_replan',
            trigger: { kind: 'onStart' },
            action: { type: 'replan', rationale: 'Planner must refresh before execution' }
          }
        ]
      }
    }

    const normalized = normalizer.normalize(envelope)
    const effect = normalizer.evaluateRunStartEffect(normalized)

    expect(effect?.kind).toBe('replan')
    expect(effect && effect.kind === 'replan' ? effect.trigger.details?.policyId : undefined).toBe('start_replan')
    expect(effect && effect.kind === 'replan' ? effect.trigger.details?.phase : undefined).toBe('startup')
  })
})
