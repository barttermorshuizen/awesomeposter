import { describe, expect, it, vi } from 'vitest'
import {
  CapabilityRecordSchema,
  type CapabilityRecord,
  type FacetDefinition,
  FacetDefinitionSchema,
  type TaskEnvelope,
  type TaskPolicies
} from '@awesomeposter/shared'
import {
  buildPlannerSystemPrompt,
  buildPlannerUserPrompt,
  type PlannerContextHints,
  type PlannerGraphContext,
  type PlannerServiceInput,
  PlannerService
} from '../src/services/planner-service'
import type { FlexCrcsReasonCode, FlexCrcsSnapshot } from '@awesomeposter/shared'

function buildFacet(name: string, direction: FacetDefinition['metadata']['direction'], description: string): FacetDefinition {
  return FacetDefinitionSchema.parse({
    name,
    title: name,
    description,
    schema: {
      type: 'object',
      additionalProperties: true
    },
    semantics: {
      summary: description,
      instruction: `Use ${name} respectfully.`
    },
    metadata: {
      version: 'v1',
      direction
    }
  })
}

function buildCapability(overrides: Partial<CapabilityRecord>): CapabilityRecord {
  const base = {
    capabilityId: 'copywriter.SocialpostDrafting',
    version: '1.0.0',
    displayName: 'Copywriter – Social Post Drafting',
    summary: 'Generates social post copy variants.',
    kind: 'execution' as const,
    agentType: 'ai' as const,
    inputContract: {
      mode: 'facets' as const,
      facets: ['creative_brief']
    },
    outputContract: {
      mode: 'facets' as const,
      facets: ['post_copy']
    },
    metadata: {},
    status: 'active' as const,
    registeredAt: '2024-01-01T00:00:00.000Z',
    lastSeenAt: '2024-01-01T00:00:00.000Z',
    inputFacets: ['creative_brief'],
    outputFacets: ['post_copy']
  }

  return CapabilityRecordSchema.parse({
    ...base,
    ...overrides
  })
}

function buildEnvelope(): TaskEnvelope {
  const policies: TaskPolicies = { planner: undefined, runtime: [] }
  return {
    objective: 'Draft LinkedIn post variants promoting our webinar',
    inputs: {
      creative_brief: {
        topic: 'Flex planner prompt redesign'
      }
    },
    constraints: {},
    policies,
    specialInstructions: ['Favor concise copy under 280 characters.'],
    metadata: {
      clientId: 'client-123'
    },
    outputContract: {
      mode: 'facets',
      facets: ['post_copy']
    }
  }
}

function buildContext(): PlannerContextHints {
  return {
    objective: 'Draft LinkedIn post variants promoting our webinar',
    variantCount: 2,
    plannerDirectives: {
      max_tokens: 1500
    },
    specialInstructions: ['Focus on call-to-action clarity.']
  }
}

function buildCrcsSnapshot(rows: Array<{
  capabilityId: string
  displayName: string
  kind?: 'structuring' | 'execution' | 'validation' | 'transformation' | 'routing'
  inputFacets?: string[]
  outputFacets?: string[]
  reasonCodes?: FlexCrcsReasonCode[]
}>): FlexCrcsSnapshot {
  const normalizedRows = rows.map((row, index) => ({
    capabilityId: row.capabilityId,
    displayName: row.displayName,
    kind: row.kind ?? 'execution',
    inputFacets: row.inputFacets ?? [],
    outputFacets: row.outputFacets ?? [],
    reasonCodes: row.reasonCodes ?? ['path'],
    source: 'mrcs'
  }))
  const reasonCounts: Record<string, number> = {}
  normalizedRows.forEach((row) => {
    row.reasonCodes.forEach((reason) => {
      reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1
    })
  })
  return {
    rows: normalizedRows,
    totalRows: normalizedRows.length,
    mrcsSize: normalizedRows.filter((row) => row.source === 'mrcs').length,
    reasonCounts,
    rowCap: 40,
    truncated: false,
    pinnedCapabilityIds: [],
    mrcsCapabilityIds: normalizedRows.filter((row) => row.source === 'mrcs').map((row) => row.capabilityId),
    missingPinnedCapabilityIds: []
  }
}

const DEFAULT_CRCS = buildCrcsSnapshot([
  {
    capabilityId: 'copywriter.SocialpostDrafting',
    displayName: 'Copywriter – Social Post Drafting',
    inputFacets: ['creative_brief'],
    outputFacets: ['post_copy'],
    reasonCodes: ['path']
  }
])

describe('planner prompt builders', () => {
  it('builds the system prompt with blueprint sections', () => {
    const facetTable =
      '| Facet | Direction | Description |\n| --- | --- | --- |\n| post_copy | output | Rendered social post copy. |'
    const capabilityTable =
      '| Capability ID | Display Name | Kind | Input Facets | Output Facets | Reason Codes |\n| --- | --- | --- | --- | --- | --- |\n| copywriter.SocialpostDrafting | Copywriter – Social Post Drafting | execution | creative_brief | post_copy | path |'
    const message = buildPlannerSystemPrompt({ facetTable, capabilityTable })
    expect(message.role).toBe('system')
    const content = message.content
    expect(content.startsWith('You are the **Flex PlannerService**.')).toBe(true)
    expect(content).toContain('### SCHEMA DEFINITION')
    expect(content).toContain('### FACET CATALOG SUMMARY')
    expect(content).toContain(facetTable)
    expect(content).toContain('### CAPABILITY REGISTRY SUMMARY')
    expect(content).toContain(capabilityTable)
    expect(content).toContain('### PLANNER RULES')
    expect(content).toContain('### INTERNAL CHECKLIST (for the model)')
    expect(content).toContain('### OUTPUT INSTRUCTIONS')
    expect(content).toContain('status: "pending" | "running" | "completed" | "awaiting_hitl" | "awaiting_human" | "error"')
    expect(content).toContain('kind?: "structuring" | "execution" | "transformation" | "validation" | "routing"')
    expect(content).toContain('routing?: {')
    expect(content).toContain('Node status semantics')
    expect(content).toMatch(/PlannerDraft = {/)
    expect(content).not.toContain('fallback"')
    expect(content).not.toContain('[FACET_NAME]')
    expect(content).not.toContain('[CAPABILITY_ID]')
  })

  it('builds the user prompt with trimmed tables and checklist reminder', () => {
    const facets: FacetDefinition[] = [
      buildFacet('creative_brief', 'input', 'Strategic brief for downstream execution nodes.'),
      buildFacet('post_copy', 'output', 'Rendered social post copy.'),
      buildFacet('diagnostic_notes', 'output', 'Additional diagnostic commentary when the run is blocked.')
    ]

    const capabilities = [
      buildCapability({ capabilityId: 'copywriter.SocialpostDrafting' }),
      buildCapability({
        capabilityId: 'diagnostics.RunSummary',
        displayName: 'Diagnostics – Run Summary',
        summary: 'Provides diagnostic notes when required facets are unavailable.',
        kind: 'validation',
        inputContract: {
          mode: 'facets',
          facets: ['diagnostic_input']
        },
        inputFacets: ['diagnostic_input'],
        outputContract: {
          mode: 'facets',
          facets: ['diagnostic_notes']
        },
        outputFacets: ['diagnostic_notes']
      })
    ]

    const graphContext: PlannerGraphContext = {
      completedNodes: [
        {
          nodeId: 'strategist_1',
          capabilityId: 'strategist.SocialPosting',
          label: 'Strategist Briefing',
          outputFacets: ['creative_brief']
        }
      ],
      facetValues: [
        {
          facet: 'creative_brief',
          sourceNodeId: 'strategist_1',
          sourceCapabilityId: 'strategist.SocialPosting',
          sourceLabel: 'Strategist Briefing',
          value: { summary: 'Key points' }
        }
      ],
      planSnapshot: {
        version: 4,
        nodes: [
          {
            nodeId: 'strategist_1',
            status: 'completed',
            capabilityId: 'strategist.SocialPosting',
            label: 'Strategist Briefing',
            kind: 'structuring'
          },
          {
            nodeId: 'copywriter_1',
            status: 'pending',
            capabilityId: 'copywriter.SocialpostDrafting',
            label: 'Copywriter',
            kind: 'execution'
          }
        ],
        pendingNodeIds: ['copywriter_1']
      }
    }

    const input: PlannerServiceInput = {
      envelope: buildEnvelope(),
      context: buildContext(),
      capabilities,
      graphContext,
      policies: { planner: undefined, runtime: [] },
      policyMetadata: {
        legacyNotes: ['Legacy policy applies'],
        legacyFields: ['toneProfile']
      },
      crcs: DEFAULT_CRCS
    }

  const result = buildPlannerUserPrompt({ input, capabilities, facets, crcs: DEFAULT_CRCS })
  const content = result.message.content

  expect(result.facetRowCount).toBeGreaterThan(0)
  expect(result.capabilityRowCount).toBeGreaterThan(0)
  expect(result.facetTable).toContain('| Facet | Direction | Description |')
  expect(result.capabilityTable).toContain('| Capability ID | Display Name | Kind | Input Facets | Output Facets | Reason Codes |')
  expect(content).not.toContain('### FACET CATALOG SUMMARY')
  expect(content).not.toContain('| Facet | Direction | Description |')
  expect(content).toContain('### EXISTING PLAN SNAPSHOT')
  expect(content).toContain('"status": "completed"')
  expect(content).toContain('Lock nodes with status `completed` exactly as provided')
  expect(content).toContain('greater than 4')
  expect(content).toContain('post_copy')
  expect(content).not.toContain('irrelevant_facet')
  expect(content).not.toContain('### CAPABILITY REGISTRY SUMMARY')
  expect(content).not.toContain('| Capability ID | Display Name | Kind | Input Facets | Output Facets | Reason Codes |')
  expect(content).not.toContain('Diagnostics – Run Summary') // trimmed because not relevant to selected facets
    expect(content).toContain('### INTERNAL CHECKLIST REMINDER')
    expect(content).toContain('Return only the final JSON object')
    expect(content).toContain('### CURRENT GRAPH CONTEXT')
  })

  it('renders capability kinds exactly as provided by the CRCS snapshot', () => {
    const facets = [
      buildFacet('creative_brief', 'output', 'Brief details.'),
      buildFacet('feedback', 'output', 'QA feedback notes.')
    ]
    const capabilities = [
      buildCapability({
        capabilityId: 'strategist.Structuring',
        displayName: 'Strategist Structuring',
        kind: 'structuring',
        outputFacets: ['creative_brief']
      }),
      buildCapability({
        capabilityId: 'qa.Validation',
        displayName: 'QA Validation',
        kind: 'validation',
        inputFacets: ['creative_brief'],
        outputFacets: ['feedback']
      })
    ]
    const crcs = buildCrcsSnapshot([
      {
        capabilityId: 'strategist.Structuring',
        displayName: 'Strategist Structuring',
        kind: 'structuring',
        outputFacets: ['creative_brief']
      },
      {
        capabilityId: 'qa.Validation',
        displayName: 'QA Validation',
        kind: 'validation',
        inputFacets: ['creative_brief'],
        outputFacets: ['feedback']
      }
    ])

    const result = buildPlannerUserPrompt({
      input: {
        envelope: buildEnvelope(),
        context: buildContext(),
        capabilities,
        policies: { planner: undefined, runtime: [] },
        crcs
      },
      capabilities,
      facets,
      crcs
    })

    expect(result.capabilityTable).toContain('| strategist.Structuring | Strategist Structuring | structuring |')
    expect(result.capabilityTable).toContain('| qa.Validation | QA Validation | validation |')
  })

  it('records telemetry for prompt sizes when proposing a plan', async () => {
    const capabilities = [buildCapability({})]
    const telemetry = { recordPlannerPromptSize: vi.fn(), recordPlannerCrcsStats: vi.fn() }
    const responses = {
      create: vi.fn().mockResolvedValue({
        output_text: JSON.stringify({
          nodes: [
            {
              stage: 'draft',
              capabilityId: 'copywriter.SocialpostDrafting',
              status: 'pending',
              kind: 'execution',
              inputFacets: ['creative_brief'],
              outputFacets: ['post_copy']
            }
          ],
          metadata: { provider: 'llm', model: 'test-model' }
        })
      })
    }
    const client = { responses } as unknown as import('openai').OpenAI
    const registry = {} as any

    const planner = new PlannerService(registry, { client, telemetry: telemetry as any, model: 'planner-test' })

    const input: PlannerServiceInput = {
      envelope: buildEnvelope(),
      context: buildContext(),
      capabilities,
      policies: { planner: undefined, runtime: [] },
      crcs: DEFAULT_CRCS
    }

    await planner.proposePlan(input)

    expect(responses.create).toHaveBeenCalledTimes(1)
    expect(telemetry.recordPlannerPromptSize).toHaveBeenCalledTimes(1)
    const telemetryPayload = telemetry.recordPlannerPromptSize.mock.calls[0][0]
    expect(telemetryPayload.systemCharacters).toBeGreaterThan(0)
    expect(telemetryPayload.userCharacters).toBeGreaterThan(0)
    expect(telemetryPayload.facetRows).toBeGreaterThan(0)
    expect(telemetryPayload.capabilityRows).toBeGreaterThan(0)
    expect(telemetry.recordPlannerCrcsStats).toHaveBeenCalledTimes(1)
    expect(telemetry.recordPlannerCrcsStats.mock.calls[0][0].totalRows).toBeGreaterThan(0)
  })

  it('adds GOAL CONDITION REPAIR details when failures exist', () => {
    const facets = [buildFacet('summary', 'output', 'Summarized status.')]
    const capabilities = [buildCapability({ capabilityId: 'summary.Writer' })]
    const crcs = buildCrcsSnapshot([
      {
        capabilityId: 'copywriter.SocialpostDrafting',
        displayName: 'Copywriter – Social Post Drafting',
        inputFacets: ['creative_brief'],
        outputFacets: ['post_copy'],
        reasonCodes: ['path']
      },
      {
        capabilityId: 'diagnostics.RunSummary',
        displayName: 'Diagnostics – Run Summary',
        kind: 'validation',
        inputFacets: ['diagnostic_input'],
        outputFacets: ['diagnostic_notes'],
        reasonCodes: ['path']
      }
    ])
    const input: PlannerServiceInput = {
      envelope: buildEnvelope(),
      context: buildContext(),
      capabilities,
      policies: { planner: undefined, runtime: [] },
      policyMetadata: { legacyNotes: [], legacyFields: [] },
      goalConditionFailures: [
        {
          facet: 'summary',
          path: '/status',
          expression: 'status == "approved"',
          dsl: 'status == "approved"',
          jsonLogic: { '==': [{ var: 'status' }, 'approved'] },
          satisfied: false,
          observedValue: 'draft',
          error: 'Condition evaluation failed.'
        }
      ],
      crcs
    }

    const result = buildPlannerUserPrompt({ input, capabilities, facets, crcs })
    expect(result.message.content).toContain('### GOAL CONDITION REPAIR')
    expect(result.message.content).toContain('Facet "summary" @ path "/status"')
    expect(result.message.content).toContain('Canonical DSL')
    expect(result.message.content).toContain('Evaluator error: Condition evaluation failed.')
  })
})
