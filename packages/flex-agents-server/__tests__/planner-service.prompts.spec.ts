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
    agentType: 'ai' as const,
    inputContract: {
      mode: 'facets' as const,
      facets: ['creative_brief']
    },
    outputContract: {
      mode: 'facets' as const,
      facets: ['post_copy']
    },
    metadata: {
      plannerKind: 'execution'
    },
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
    channel: 'social',
    platform: 'linkedin',
    formats: ['post'],
    languages: ['en'],
    audiences: ['b2b_marketers'],
    tags: ['webinar', 'flex'],
    variantCount: 2,
    plannerDirectives: {
      max_tokens: 1500
    },
    specialInstructions: ['Focus on call-to-action clarity.']
  }
}

describe('planner prompt builders', () => {
  it('builds the system prompt with blueprint sections', () => {
    const facetTable =
      '| Facet | Direction | Description |\n| --- | --- | --- |\n| post_copy | output | Rendered social post copy. |'
    const capabilityTable =
      '| Capability ID | Display Name | Kind | Input Facets | Output Facets | Summary |\n| --- | --- | --- | --- | --- | --- |\n| copywriter.SocialpostDrafting | Copywriter – Social Post Drafting | execution | creative_brief | post_copy | Generates social post copy variants. |'
    const message = buildPlannerSystemPrompt({ facetTable, capabilityTable })
    expect(message.role).toBe('system')
    const content = message.content
    expect(content).toContain('SYSTEM:')
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
        metadata: { plannerKind: 'validation' },
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
      }
    }

  const result = buildPlannerUserPrompt({ input, capabilities, facets })
  const content = result.message.content

  expect(result.facetRowCount).toBeGreaterThan(0)
  expect(result.capabilityRowCount).toBeGreaterThan(0)
  expect(result.facetTable).toContain('| Facet | Direction | Description |')
  expect(result.capabilityTable).toContain('| Capability ID | Display Name | Kind | Input Facets | Output Facets | Summary |')
  expect(content).not.toContain('### FACET CATALOG SUMMARY')
  expect(content).not.toContain('| Facet | Direction | Description |')
  expect(content).toContain('### EXISTING PLAN SNAPSHOT')
  expect(content).toContain('"status": "completed"')
  expect(content).toContain('Lock nodes with status `completed` exactly as provided')
  expect(content).toContain('greater than 4')
  expect(content).toContain('post_copy')
  expect(content).not.toContain('irrelevant_facet')
  expect(content).not.toContain('### CAPABILITY REGISTRY SUMMARY')
  expect(content).not.toContain('| Capability ID | Display Name | Kind | Input Facets | Output Facets | Summary |')
  expect(content).not.toContain('Diagnostics – Run Summary') // trimmed because not relevant to selected facets
    expect(content).toContain('### INTERNAL CHECKLIST REMINDER')
    expect(content).toContain('Return only the final JSON object')
    expect(content).toContain('### CURRENT GRAPH CONTEXT')
  })

  it('records telemetry for prompt sizes when proposing a plan', async () => {
    const capabilities = [buildCapability({})]
    const telemetry = { recordPlannerPromptSize: vi.fn() }
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
      policies: { planner: undefined, runtime: [] }
    }

    await planner.proposePlan(input)

    expect(responses.create).toHaveBeenCalledTimes(1)
    expect(telemetry.recordPlannerPromptSize).toHaveBeenCalledTimes(1)
    const telemetryPayload = telemetry.recordPlannerPromptSize.mock.calls[0][0]
    expect(telemetryPayload.systemCharacters).toBeGreaterThan(0)
    expect(telemetryPayload.userCharacters).toBeGreaterThan(0)
    expect(telemetryPayload.facetRows).toBeGreaterThan(0)
    expect(telemetryPayload.capabilityRows).toBeGreaterThan(0)
  })
})
