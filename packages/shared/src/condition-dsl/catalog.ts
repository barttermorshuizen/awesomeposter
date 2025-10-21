import { defaultAllowedOperatorsForType } from './engine.js'
import type {
  ConditionVariableCatalog,
  ConditionVariableDefinition,
  ConditionVariableType,
} from './types.js'

interface CatalogEntryInput {
  id: string
  path: string
  label: string
  type: ConditionVariableType
  description?: string
  example?: unknown
  allowedOperators?: ConditionVariableDefinition['allowedOperators']
}

const registry: readonly CatalogEntryInput[] = [
  {
    id: 'qaFindings.overallScore',
    path: 'qaFindings.overallScore',
    label: 'QA Findings · Overall Score',
    group: 'QA Findings',
    type: 'number',
    description: 'Aggregated QA score between 0 and 1. Lower indicates higher risk.',
    example: 0.42,
  },
  {
    id: 'qaFindings.flagsCount',
    path: 'qaFindings.flagsCount',
    label: 'QA Findings · Flags Count',
    group: 'QA Findings',
    type: 'number',
    description: 'Total number of QA flags raised for the run.',
    example: 3,
  },
  {
    id: 'qaFindings.containsCritical',
    path: 'qaFindings.containsCritical',
    label: 'QA Findings · Has Critical Flag',
    group: 'QA Findings',
    type: 'boolean',
    description: 'True when a critical QA flag (policy violation) is present.',
    example: true,
  },
  {
    id: 'qaFindings.flagCodes',
    path: 'qaFindings.flagCodes',
    label: 'QA Findings · Flag Codes',
    group: 'QA Findings',
    type: 'array',
    description: 'List of QA flag identifiers generated during the run.',
    example: ['plagiarism', 'safety_low_confidence'],
  },
  {
    id: 'brief.id',
    path: 'brief.id',
    label: 'Brief · Identifier',
    group: 'Brief Metadata',
    type: 'string',
    description: 'Unique identifier for the originating brief.',
    example: 'brief_123',
  },
  {
    id: 'brief.language',
    path: 'brief.language',
    label: 'Brief · Language',
    group: 'Brief Metadata',
    type: 'string',
    description: 'ISO language code for the requested output.',
    example: 'en-US',
  },
  {
    id: 'brief.priority',
    path: 'brief.priority',
    label: 'Brief · Priority',
    group: 'Brief Metadata',
    type: 'string',
    description: 'Operational priority (e.g. `standard`, `urgent`, `pilot`).',
    example: 'pilot',
  },
  {
    id: 'run.latencyMs',
    path: 'run.latencyMs',
    label: 'Run · Latency (ms)',
    group: 'Runtime Signals',
    type: 'number',
    description: 'Total elapsed time in milliseconds for the planner run.',
    example: 1280,
  },
  {
    id: 'run.revisionCount',
    path: 'run.revisionCount',
    label: 'Run · Revisions Count',
    group: 'Runtime Signals',
    type: 'number',
    description: 'Number of revisions requested during the run.',
    example: 2,
  },
  {
    id: 'run.requiresHitl',
    path: 'run.requiresHitl',
    label: 'Run · Requires HITL',
    group: 'Runtime Signals',
    type: 'boolean',
    description: 'True when the run is waiting on a human-in-the-loop response.',
    example: false,
  },
] as const

const concreteRegistry: ConditionVariableDefinition[] = registry.map((entry) => ({
  ...entry,
  allowedOperators: entry.allowedOperators ?? defaultAllowedOperatorsForType(entry.type),
}))

export const conditionVariableCatalog: ConditionVariableCatalog = {
  variables: concreteRegistry,
}

export function buildCatalogLookup(): Map<string, ConditionVariableDefinition> {
  const map = new Map<string, ConditionVariableDefinition>()
  for (const variable of concreteRegistry) {
    map.set(variable.path, variable)
  }
  return map
}
