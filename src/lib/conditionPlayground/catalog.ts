import {
  conditionVariableCatalog,
  type ConditionVariableCatalog,
  type ConditionVariableDefinition,
} from '@awesomeposter/shared'

export type PlaygroundVariable = ConditionVariableDefinition

export interface PlaygroundSamplePayload {
  id: string
  label: string
  description?: string
  payload: Record<string, unknown>
}

export const playgroundVariables: readonly PlaygroundVariable[] =
  conditionVariableCatalog.variables

export const playgroundSamples: readonly PlaygroundSamplePayload[] = [
  {
    id: 'plan-needs-review',
    label: 'High hook intensity, awaiting planner review',
    description: 'A run with aggressive hook intensity and open recommendations.',
    payload: {
      metadata: {
        runContextSnapshot: {
          facets: {
            planKnobs: {
              value: {
                hookIntensity: 0.72,
                variantCount: 3,
                formatType: 'video',
              },
            },
            recommendationSet: {
              value: [
                { id: 'rec-1', severity: 'critical', recommendation: 'Escalate to QA', status: 'open' },
                { id: 'rec-2', severity: 'minor', recommendation: 'Polish CTA', status: 'open' },
              ],
            },
            clarificationResponse: {
              value: { readyForPlanner: false, submittedAt: null },
            },
          },
        },
      },
      run: {
        latencyMs: 1820,
        revisionCount: 3,
        requiresHitl: true,
      },
    },
  },
  {
    id: 'plan-healthy',
    label: 'Balanced plan knobs, no outstanding actions',
    description: 'Successful run with moderate hook intensity and cleared recommendations.',
    payload: {
      metadata: {
        runContextSnapshot: {
          facets: {
            planKnobs: {
              value: {
                hookIntensity: 0.38,
                variantCount: 2,
                formatType: 'text',
              },
            },
            recommendationSet: {
              value: [
                { id: 'rec-1', severity: 'minor', recommendation: 'Tighten intro', status: 'closed' },
              ],
            },
            clarificationResponse: {
              value: { readyForPlanner: true, submittedAt: '2025-02-11T09:35:00Z' },
            },
          },
        },
      },
      run: {
        latencyMs: 960,
        revisionCount: 1,
        requiresHitl: false,
      },
    },
  },
  {
    id: 'plan-awaiting-hitl',
    label: 'Awaiting HITL with open recommendations',
    description: 'Run paused for operator input with mixed severities.',
    payload: {
      metadata: {
        runContextSnapshot: {
          facets: {
            planKnobs: {
              value: {
                hookIntensity: 0.58,
                variantCount: 2,
                formatType: 'single_image',
              },
            },
            recommendationSet: {
              value: [
                { id: 'rec-1', severity: 'major', recommendation: 'Rework visuals', status: 'open' },
                { id: 'rec-2', severity: 'minor', recommendation: 'Adjust closing line', status: 'open' },
              ],
            },
            clarificationResponse: {
              value: { readyForPlanner: false },
            },
          },
        },
      },
      run: {
        latencyMs: 2400,
        revisionCount: 4,
        requiresHitl: true,
      },
    },
  },
] as const

export function getCatalog(): ConditionVariableCatalog {
  return conditionVariableCatalog
}

export function buildVariableLookup(): Map<string, PlaygroundVariable> {
  const map = new Map<string, PlaygroundVariable>()
  for (const variable of conditionVariableCatalog.variables) {
    map.set(variable.id, variable)
  }
  return map
}
