import { z } from 'zod'
import { OpenAI } from 'openai'
import type { TaskEnvelope, CapabilityRecord, FacetDefinition } from '@awesomeposter/shared'
import { getFacetCatalog } from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'

const StringOrArraySchema = z
  .union([z.array(z.string().min(1)), z.string().min(1)])
  .transform((value) => (Array.isArray(value) ? value : [value]))

const FacetListSchema = z
  .union([
    z.array(z.string().min(1)),
    z.string().min(1),
    z.record(z.unknown())
  ])
  .transform((value) => {
    if (Array.isArray(value)) return value
    if (typeof value === 'string') return [value]
    return Object.keys(value)
  })

const PlannerDraftNodeSchema = z.object({
  label: z.string().min(1).optional(),
  stage: z.string().min(1),
  capabilityId: z.string().min(1).optional(),
  derived: z.boolean().optional(),
  kind: z
    .enum(['structuring', 'branch', 'execution', 'transformation', 'validation', 'fallback'])
    .optional(),
  inputFacets: FacetListSchema.optional(),
  outputFacets: FacetListSchema.optional(),
  rationale: StringOrArraySchema.optional(),
  instructions: StringOrArraySchema.optional()
})

const PlannerDraftBranchSchema = z.object({
  id: z.string().min(1).optional(),
  label: z.string().min(1),
  rationale: z.string().min(1).optional()
})

const PlannerDraftMetadataSchema = z.object({
  provider: z.string().min(1).optional(),
  model: z.string().min(1).optional()
})

const PlannerDraftSchema = z.object({
  nodes: z.array(PlannerDraftNodeSchema).min(1),
  branchRequests: z.array(PlannerDraftBranchSchema).optional(),
  metadata: PlannerDraftMetadataSchema.optional()
})

export type PlannerDraftNode = z.infer<typeof PlannerDraftNodeSchema>
export type PlannerDraftBranch = z.infer<typeof PlannerDraftBranchSchema>
export type PlannerDraftMetadata = z.infer<typeof PlannerDraftMetadataSchema>

export type PlannerDraft = {
  nodes: PlannerDraftNode[]
  branchRequests?: PlannerDraftBranch[]
  metadata?: PlannerDraftMetadata
}

export type PlannerServiceInput = {
  envelope: TaskEnvelope
  scenario: string
  variantCount: number
  capabilities: CapabilityRecord[]
}

export interface PlannerServiceInterface {
  proposePlan(input: PlannerServiceInput): Promise<PlannerDraft>
}

export class PlannerService implements PlannerServiceInterface {
  private readonly client: OpenAI
  private readonly capabilityRegistry: FlexCapabilityRegistryService
  private readonly timeoutMs: number
  private readonly model: string

  constructor(
    capabilityRegistry: FlexCapabilityRegistryService = getFlexCapabilityRegistryService(),
    options?: { timeoutMs?: number; client?: OpenAI; model?: string }
  ) {
    this.capabilityRegistry = capabilityRegistry
    this.client =
      options?.client ??
      new OpenAI({
        apiKey: process.env.FLEX_OPENAI_API_KEY || process.env.OPENAI_API_KEY
      })
    const defaultTimeout = Number(process.env.FLEX_PLANNER_TIMEOUT_MS || 180000)
    this.timeoutMs = options?.timeoutMs ?? defaultTimeout
    this.model =
      options?.model ??
      process.env.FLEX_PLANNER_MODEL ??
      process.env.OPENAI_DEFAULT_MODEL ??
      process.env.OPENAI_MODEL ??
      'gpt-4o-mini'
  }

  async proposePlan(input: PlannerServiceInput): Promise<PlannerDraft> {
    const catalog = getFacetCatalog()
    const facetDefinitions = catalog.list()
    const capabilitySnapshot =
      input.capabilities.length > 0 ? input.capabilities : (await this.capabilityRegistry.getSnapshot()).active
    const systemMessage = this.composeSystemPrompt()
    const userMessage = this.composeUserPrompt(input, capabilitySnapshot, facetDefinitions)
    const llmPromise = this.invokeResponsesApi([systemMessage, userMessage], PlannerDraftSchema)

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Planner draft timed out')), Math.max(this.timeoutMs, 1000))
      })
      const result = (await Promise.race([llmPromise, timeoutPromise])) as PlannerDraft
      return {
        nodes: result.nodes ?? [],
        branchRequests: result.branchRequests,
        metadata: {
          provider: result.metadata?.provider ?? 'llm',
          model: result.metadata?.model ?? this.model
        }
      }
    } catch (error) {
      llmPromise.catch(() => undefined)
      try {
        getLogger().warn('flex_planner_llm_fallback', {
          reason: error instanceof Error ? error.message : String(error)
        })
      } catch {}
      return this.buildFallbackDraft(input)
    }
  }

  private composeSystemPrompt() {
    return {
      role: 'system' as const,
      content: [
        'You are the Flex PlannerService. Produce a valid JSON plan exactly matching the following Zod schema:',
        '--- SCHEMA START ---',
        'PlannerDraft = {',
        '  nodes: Array<{',
        '    stage?: string',
        '    capabilityId?: string',
        '    derived?: boolean',
        '    kind?: "structuring" | "branch" | "execution" | "transformation" | "validation" | "fallback"',
        '    inputFacets?: string[] | string | Record<string, unknown>',
        '    outputFacets?: string[] | string | Record<string, unknown>',
        '    rationale?: string | string[]',
        '    instructions?: string | string[]',
        '  }>',
        '  branchRequests?: Array<{',
        '    id?: string',
        '    label: string',
        '    rationale?: string',
        '  }>',
        '  metadata?: { provider?: string; model?: string }',
        '}',
        '--- SCHEMA END ---',
        'The user provides:',
        '- A task objective',
        '- Inputs',
        '- Policies',
        '- Special instructions',
        '- An output contract',
        'You also have access to:',
        '- A list of available capabilities, each with input/output facets (JSON fragments) and descriptions',
        '- A facet catalog describing the valid facet types, a description of the facet and the direction',
        'Your job is to:',
        '- Analyze the objective, inputs, and output expectations',
        '- Select the **minimal set of capabilities** needed to produce the required output facets',
        '- Route facets correctly between nodes, respecting capability I/O contracts',
        '- Include fallback nodes only when risks are high and policy allows automation',
        'Reason from capability definitions. Include only the capabilities needed to achieve the objective given the available inputs and required outputs.',
        '- When required facets are missing and no fallback is possible, return JSON that captures the failure instead of inventing data.',
        'CRITICALLY:',
        '- Do not fabricate content. If a facet is required but not supported by inputs, leave it empty or minimal.',
        '- Do not invent personas, tone guidance, structural elements, or business details.',
        '- Do not add nodes or capabilities unless their use is clearly justified by the objective and facet flow.',
        'Your output must be:',
        '- JSON only (no markdown or comments)',
        '- Strictly compliant with the facet catalog and capability definitions',
        '- Fully grounded in user input.'
      ].join('\n')
    }
  }

  private composeUserPrompt(
    input: PlannerServiceInput,
    capabilities: CapabilityRecord[],
    facets: FacetDefinition[]
  ) {
    const envelopeLines = [
      `Objective: ${input.envelope.objective}`,
      `Scenario: ${input.scenario}`,
      `Variant Count: ${input.variantCount}`,
      `Policies: ${JSON.stringify(input.envelope.policies ?? {}, null, 2)}`,
      `Inputs Summary: ${JSON.stringify(input.envelope.inputs ?? {}, null, 2)}`,
      input.envelope.specialInstructions && input.envelope.specialInstructions.length
        ? `Special Instructions: ${JSON.stringify(input.envelope.specialInstructions, null, 2)}`
        : null,
      `Output Contract: ${JSON.stringify(input.envelope.outputContract, null, 2)}`
    ]
      .filter((line): line is string => Boolean(line))

    const capabilityLines = capabilities.map((capability) => {
      const facetsInfo = [
        `Input facets: ${(capability.inputFacets ?? []).join(', ') || 'none'}`,
        `Output facets: ${(capability.outputFacets ?? []).join(', ') || 'none'}`
      ].join(' | ')
      return `- ${capability.capabilityId} :: ${capability.summary} :: ${facetsInfo}`
    })

    const facetLines = facets.map((facet) => {
      const direction = facet.metadata?.direction ?? 'unknown'
      return `- ${facet.name} (${direction}) :: ${facet.description}`
    })

    return {
      role: 'user' as const,
      content: [
        'Create a planner draft for the Flex orchestrator.',
        envelopeLines.join('\n'),
        'Available capabilities:',
        capabilityLines.join('\n'),
        'Facet catalog summary:',
        facetLines.slice(0, 25).join('\n'),
        'Return JSON with nodes including stage, capabilityId, derived flag, inputFacets, outputFacets, and rationale.'
      ].join('\n\n')
    }
  }

  private async invokeResponsesApi(
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    schema: z.ZodType<PlannerDraft, z.ZodTypeDef, unknown>
  ): Promise<PlannerDraft> {
    const prompt = messages.map((msg) => `${msg.role.toUpperCase()}:\n${msg.content}`).join('\n\n')

    const response = await this.client.responses.create({
      model: this.model,
      input: prompt
    })

    const fallbackSegments =
      Array.isArray(response.output) ?
        response.output
          .map((item) => {
            if (!item || typeof item !== 'object') return null
            const candidate = item as { content?: Array<{ text?: { value?: unknown } }> }
            const value = candidate.content?.[0]?.text?.value
            return typeof value === 'string' ? value : null
          })
          .filter((value): value is string => Boolean(value))
      : []

    const text = (response.output_text ?? '').trim() || fallbackSegments.join('\n').trim()

    if (!text) {
      throw new Error('Planner LLM returned no content')
    }

    let parsedJson: unknown
    try {
      parsedJson = JSON.parse(text)
    } catch (error) {
      throw new Error(`Planner draft JSON parse failed: ${(error as Error).message}`)
    }

    const parsed = schema.safeParse(parsedJson)
    if (!parsed.success) {
      throw new Error(`Planner draft validation failed: ${parsed.error.message}`)
    }

    return parsed.data
  }

  private buildFallbackDraft(input: PlannerServiceInput): PlannerDraft {
    const baseNodes: PlannerDraftNode[] = [
      { stage: 'strategy', kind: 'structuring', capabilityId: 'StrategyManagerAgent.briefing', derived: true },
      { stage: 'generation', kind: 'execution', capabilityId: 'ContentGeneratorAgent.linkedinVariants', derived: input.scenario !== 'linkedin_post_variants' },
      { stage: 'qa', kind: 'validation', capabilityId: 'QualityAssuranceAgent.contentReview', derived: true }
    ]
    return {
      nodes: baseNodes,
      branchRequests: undefined,
      metadata: {
        provider: 'deterministic-fallback'
      }
    }
  }
}
