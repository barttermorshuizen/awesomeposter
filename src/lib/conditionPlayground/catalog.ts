import type { MockConditionCatalog, MockConditionVariableType } from '@awesomeposter/shared'

export interface PlaygroundVariable {
  id: string
  path: string
  label: string
  type: MockConditionVariableType
  group: string
  description?: string
  example?: unknown
}

export interface PlaygroundSamplePayload {
  id: string
  label: string
  description?: string
  payload: Record<string, unknown>
}

export const playgroundVariables: readonly PlaygroundVariable[] = [
  {
    id: 'qaFindings.overallScore',
    path: 'qaFindings.overallScore',
    label: 'QA Findings · Overall Score',
    type: 'number',
    group: 'QA Findings',
    description: 'Aggregated QA score between 0 and 1. Lower indicates higher risk.',
    example: 0.42,
  },
  {
    id: 'qaFindings.flagsCount',
    path: 'qaFindings.flagsCount',
    label: 'QA Findings · Flags Count',
    type: 'number',
    group: 'QA Findings',
    description: 'Total number of QA flags raised for the run.',
    example: 3,
  },
  {
    id: 'qaFindings.containsCritical',
    path: 'qaFindings.containsCritical',
    label: 'QA Findings · Has Critical Flag',
    type: 'boolean',
    group: 'QA Findings',
    description: 'True when a critical flag was raised (e.g. policy violation).',
    example: true,
  },
  {
    id: 'qaFindings.flagCodes',
    path: 'qaFindings.flagCodes',
    label: 'QA Findings · Flag Codes',
    type: 'array',
    group: 'QA Findings',
    description: 'List of QA flag identifiers attached to the run.',
    example: ['plagiarism', 'safety_low_confidence'],
  },
  {
    id: 'brief.id',
    path: 'brief.id',
    label: 'Brief · Identifier',
    type: 'string',
    group: 'Brief Metadata',
    description: 'Unique identifier for the originating brief.',
    example: 'brief_123',
  },
  {
    id: 'brief.language',
    path: 'brief.language',
    label: 'Brief · Language',
    type: 'string',
    group: 'Brief Metadata',
    description: 'ISO language code for the requested output.',
    example: 'en-US',
  },
  {
    id: 'brief.priority',
    path: 'brief.priority',
    label: 'Brief · Priority',
    type: 'string',
    group: 'Brief Metadata',
    description: 'Operational priority (e.g. `standard`, `urgent`, `pilot`).',
    example: 'pilot',
  },
  {
    id: 'run.latencyMs',
    path: 'run.latencyMs',
    label: 'Run · Latency (ms)',
    type: 'number',
    group: 'Runtime Signals',
    description: 'Total elapsed time in milliseconds for the planner run.',
    example: 1280,
  },
  {
    id: 'run.revisionCount',
    path: 'run.revisionCount',
    label: 'Run · Revisions Count',
    type: 'number',
    group: 'Runtime Signals',
    description: 'Number of revisions requested during the run.',
    example: 2,
  },
  {
    id: 'run.requiresHitl',
    path: 'run.requiresHitl',
    label: 'Run · Requires HITL',
    type: 'boolean',
    group: 'Runtime Signals',
    description: 'True when the run is waiting on a human-in-the-loop response.',
    example: false,
  },
] as const

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

export function createMockCatalog(): MockConditionCatalog {
  return {
    variables: playgroundVariables.map((variable) => ({
      id: variable.id,
      path: variable.path,
      type: variable.type,
    })),
  }
}

export function buildVariableLookup(): Map<string, PlaygroundVariable> {
  const map = new Map<string, PlaygroundVariable>()
  for (const variable of playgroundVariables) {
    map.set(variable.id, variable)
  }
  return map
}
