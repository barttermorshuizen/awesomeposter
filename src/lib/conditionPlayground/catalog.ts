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
    id: 'qa-low-score',
    label: 'Low QA Score, Critical Flag',
    description: 'Represents a run with poor QA results triggering failover.',
    payload: {
      qaFindings: {
        overallScore: 0.42,
        flagsCount: 4,
        containsCritical: true,
        flagCodes: ['plagiarism', 'brand_voice_violation'],
      },
      brief: {
        id: 'brief_low_score',
        language: 'en-US',
        priority: 'urgent',
      },
      run: {
        latencyMs: 1820,
        revisionCount: 3,
        requiresHitl: true,
      },
    },
  },
  {
    id: 'qa-healthy',
    label: 'Healthy QA Result',
    description: 'Successful run with high QA score and no flags.',
    payload: {
      qaFindings: {
        overallScore: 0.91,
        flagsCount: 0,
        containsCritical: false,
        flagCodes: [],
      },
      brief: {
        id: 'brief_success',
        language: 'en-US',
        priority: 'standard',
      },
      run: {
        latencyMs: 960,
        revisionCount: 1,
        requiresHitl: false,
      },
    },
  },
  {
    id: 'hitl-waiting',
    label: 'Awaiting HITL',
    description: 'Run paused for operator input with moderate QA flags.',
    payload: {
      qaFindings: {
        overallScore: 0.63,
        flagsCount: 2,
        containsCritical: false,
        flagCodes: ['tone_low_confidence'],
      },
      brief: {
        id: 'brief_hitl_wait',
        language: 'es-ES',
        priority: 'pilot',
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
