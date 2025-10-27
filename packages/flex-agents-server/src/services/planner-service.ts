import { z } from 'zod'
import { OpenAI } from 'openai'
import type { TaskEnvelope, CapabilityRecord, FacetDefinition, TaskPolicies } from '@awesomeposter/shared'
import { getFacetCatalog } from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'
import { PlannerDraftNode, PlannerDraftSchema, type PlannerDraft } from '../planner/planner-types'

export type PlannerGraphNodeSummary = {
  nodeId: string
  capabilityId: string | null
  label: string
  outputFacets: string[]
}

export type PlannerGraphFacetValue = {
  facet: string
  sourceNodeId: string
  sourceCapabilityId: string | null
  sourceLabel: string
  value: unknown
}

export type PlannerGraphContext = {
  completedNodes: PlannerGraphNodeSummary[]
  facetValues: PlannerGraphFacetValue[]
}

export type PlannerContextHints = {
  objective: string
  channel?: string
  platform?: string
  formats: string[]
  languages: string[]
  audiences: string[]
  tags: string[]
  variantCount: number
  plannerDirectives: Record<string, unknown>
  specialInstructions: string[]
}

const MAX_FACET_VALUE_LENGTH = 800

function serializeFacetValue(value: unknown, maxLength = MAX_FACET_VALUE_LENGTH): string {
  try {
    const json = JSON.stringify(value, null, 2)
    if (!json) return ''
    if (json.length <= maxLength) return json
    return `${json.slice(0, maxLength)}...`
  } catch {
    const fallback = String(value)
    if (fallback.length <= maxLength) return fallback
    return `${fallback.slice(0, maxLength)}...`
  }
}

function normalizeHint(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export type PlannerServiceInput = {
  envelope: TaskEnvelope
  context: PlannerContextHints
  capabilities: CapabilityRecord[]
  graphContext?: PlannerGraphContext
  policies: TaskPolicies
  policyMetadata?: {
    legacyNotes: string[]
    legacyFields: string[]
  }
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
        '    kind?: "structuring" | "execution" | "transformation" | "validation" | "fallback"',
        '    inputFacets?: string[] | string | Record<string, unknown>',
        '    outputFacets?: string[] | string | Record<string, unknown>',
        '    rationale?: string | string[]',
        '    instructions?: string | string[]',
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
        '',
        'Planner rules:',
        '1. Every non-virtual node MUST set `capabilityId` to exactly one of the provided capability IDs.',
        '2. Before selecting a capability, ensure every required input facet or schema field is available from the envelope or a prior node; if not, add the upstream node that produces it.',
        '3. Never invent new capability IDs or placeholder names; reuse the registry values verbatim.',
        '4. Use only facet names that appear in the capability definitions or facet catalog. Do not invent new facet keys.',
        '5. Honor the input contract schema (including required properties and enums). Rely on the orchestrator for baked-in facet normalization (objective mappings, tone enums, clarification shapes) instead of adding structuring helper nodes.',
        '6. Do NOT output controller helper nodes such as "normalize_input_facets" or "shape_clarification_request"; the orchestrator performs these transformations automatically.',
        '7. When the selected capability is human-operated (`capabilityId` starting with "HumanAgent."), avoid inserting automated strategy or content planning nodes just to populate context facets like `writerBrief`, `planKnobs`, or `strategicRationale`. Rely on provided inputs or return diagnostics if critical data is unavailable.',
        '8. If no suitable capability exists, return diagnostics describing the gap rather than creating anonymous stages.',
        '9. Do NOT add standalone "normalization" or other controller-managed nodes unless the special instructions explicitly demand it—the orchestrator already handles schema shaping.',
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
    const context = input.context
    const planningHints = [
      context.channel ? `Primary channel: ${context.channel}` : null,
      context.platform ? `Platform: ${context.platform}` : null,
      context.formats.length ? `Format expectations: ${context.formats.join(', ')}` : null,
      context.languages.length ? `Languages: ${context.languages.join(', ')}` : null,
      context.audiences.length ? `Audience descriptors: ${context.audiences.join(', ')}` : null,
      context.tags.length ? `Tags: ${context.tags.join(', ')}` : null,
      `Variant count: ${context.variantCount}`
    ].filter((line): line is string => Boolean(line))

    if (Object.keys(context.plannerDirectives).length) {
      planningHints.push(`Planner directives: ${JSON.stringify(context.plannerDirectives, null, 2)}`)
    }

    const planningHintsBlock =
      planningHints.length ?
        ['Planning hints:', ...planningHints.map((line) => `  - ${line}`)].join('\n')
        : null

    const envelopeLines = [
      `Objective: ${context.objective}`,
      planningHintsBlock,
      `Policies: ${JSON.stringify(input.policies, null, 2)}`,
      input.policyMetadata?.legacyNotes?.length ? `Policy Notes: ${input.policyMetadata.legacyNotes.join('; ')}` : null,
      input.policyMetadata?.legacyFields?.length
        ? `Legacy Policy Fields: ${input.policyMetadata.legacyFields.join(', ')}`
        : null,
      `Inputs Summary: ${JSON.stringify(input.envelope.inputs ?? {}, null, 2)}`,
      input.envelope.specialInstructions && input.envelope.specialInstructions.length
        ? `Special Instructions: ${JSON.stringify(input.envelope.specialInstructions, null, 2)}`
        : null,
      `Output Contract: ${JSON.stringify(input.envelope.outputContract, null, 2)}`
    ]
      .filter((line): line is string => Boolean(line))

    const capabilityLines = capabilities.map((capability) => {
      const inputFacets = (capability.inputFacets ?? []).join(', ') || 'none'
      const outputFacets = (capability.outputFacets ?? []).join(', ') || 'none'

      const inputContractLines: string[] = []
      if (capability.inputContract) {
        if (capability.inputContract.mode === 'facets') {
          inputContractLines.push(`  Input contract: facets -> ${(capability.inputContract.facets ?? []).join(', ') || 'none'}`)
        } else if ('schema' in capability.inputContract && capability.inputContract.schema) {
          const schema = JSON.stringify(capability.inputContract.schema, null, 2)
          inputContractLines.push('  Input contract schema:')
          inputContractLines.push(schema
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n'))
        }
      }

      const outputContractLines: string[] = []
      if (capability.outputContract) {
        if (capability.outputContract.mode === 'facets') {
          outputContractLines.push(`  Output contract: facets -> ${(capability.outputContract.facets ?? []).join(', ') || 'none'}`)
        } else if ('schema' in capability.outputContract && capability.outputContract.schema) {
          const schema = JSON.stringify(capability.outputContract.schema, null, 2)
          outputContractLines.push('  Output contract schema:')
          outputContractLines.push(schema
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n'))
        }
      }

      return [
        `- Capability ID: ${capability.capabilityId}`,
        `  Display: ${capability.displayName}`,
        `  Summary: ${capability.summary}`,
        `  Input facets: ${inputFacets}`,
        `  Output facets: ${outputFacets}`,
        ...inputContractLines,
        ...outputContractLines
      ].join('\n')
    })

    const facetLines = facets.map((facet) => {
      const direction = facet.metadata?.direction ?? 'unknown'
      return `- ${facet.name} (${direction}) :: ${facet.description}`
    })

    const graphSections: string[] = []
    if (input.graphContext) {
      if (input.graphContext.completedNodes.length) {
        const nodeLines = input.graphContext.completedNodes.map((node) => {
          const capability = node.capabilityId ?? 'virtual'
          const facetList = node.outputFacets.length ? node.outputFacets.join(', ') : 'none'
          return `- ${node.label} (${node.nodeId}) :: capability=${capability} | output facets=${facetList}`
        })
        graphSections.push(['Completed nodes already executed:', ...nodeLines].join('\n'))
      }
      if (input.graphContext.facetValues.length) {
        const maxEntries = 12
        const recentValues = input.graphContext.facetValues.slice(-maxEntries)
        const facetValueLines = recentValues.map((entry) => {
          const serialized = serializeFacetValue(entry.value)
          const indented = serialized
            .split('\n')
            .map((line) => `    ${line}`)
            .join('\n')
          const capability = entry.sourceCapabilityId ?? 'virtual'
          return `- ${entry.facet} (from ${entry.sourceLabel} / ${entry.sourceNodeId} :: capability=${capability}):\n${indented}`
        })
        graphSections.push(
          [
            'Facet values from completed nodes (values truncated to 800 characters when needed):',
            ...facetValueLines
          ].join('\n')
        )
      }
    }

    const sections: string[] = [
      'Create a planner draft for the Flex orchestrator.',
      envelopeLines.join('\n'),
      'Select `capabilityId` values from the following registered capabilities (copy IDs exactly as shown):',
      capabilityLines.join('\n\n'),
      'Facet catalog summary:',
      facetLines.slice(0, 25).join('\n')
    ]

    if (graphSections.length) {
      sections.push('Current graph context from completed nodes:')
      sections.push(...graphSections)
    }

    sections.push(
      'Return JSON with nodes including stage, capabilityId, derived flag, inputFacets, outputFacets, and rationale. Do not create capabilities that are not listed.',
      'When referring to variants, use the existing facet `copyVariants` (or other cataloged facets) instead of inventing new names.',
      'Skip controller-managed normalization nodes unless the special instructions in this request explicitly require one.'
    )

    return {
      role: 'user' as const,
      content: sections.join('\n\n')
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
    const generationCapability = input.capabilities.find(
      (capability) => capability.capabilityId === 'ContentGeneratorAgent.linkedinVariants'
    )
    const normalizedFormats = input.context.formats.map(normalizeHint)
    const capabilityFormats = generationCapability?.inputTraits?.formats ?? []
    const capabilityMatchesFormat =
      normalizedFormats.length && capabilityFormats.length
        ? capabilityFormats.map(normalizeHint).some((format) => normalizedFormats.includes(format))
        : false

    const baseNodes: PlannerDraftNode[] = [
      { stage: 'strategy', kind: 'structuring', capabilityId: 'StrategyManagerAgent.briefing', derived: true },
      {
        stage: 'generation',
        kind: 'execution',
        capabilityId: 'ContentGeneratorAgent.linkedinVariants',
        derived: !capabilityMatchesFormat
      },
      { stage: 'qa', kind: 'validation', capabilityId: 'QualityAssuranceAgent.contentReview', derived: true }
    ]
    return {
      nodes: baseNodes,
      metadata: {
        provider: 'deterministic-fallback'
      }
    }
  }
}
