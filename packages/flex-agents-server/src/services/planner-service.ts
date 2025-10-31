import { z } from 'zod'
import { OpenAI } from 'openai'
import type { TaskEnvelope, CapabilityRecord, FacetDefinition, TaskPolicies } from '@awesomeposter/shared'
import { getFacetCatalog } from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'
import { getTelemetryService } from './telemetry-service'
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
const MAX_FACET_ROWS = 40
const MAX_CAPABILITY_ROWS = 40
const MAX_GRAPH_FACET_ENTRIES = 12

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

type PlannerPromptMessage = { role: 'system' | 'user'; content: string }

type PlannerUserPromptResult = {
  message: PlannerPromptMessage
  facetRowCount: number
  capabilityRowCount: number
  facetTable: string
  capabilityTable: string
}

type PlannerTelemetry = ReturnType<typeof getTelemetryService>

const INTERNAL_CHECKLIST_LINES = [
  '1. Are all required output facets from the output contract covered?',
  '2. Are all input facets of each node available from the envelope or previous outputs?',
  '3. Are all capability IDs valid from the registry?',
  '4. Did you avoid invented facets, stages, or helper nodes?',
  '5. Does each node include a rationale?'
]

export function buildPlannerSystemPrompt(params: { facetTable: string; capabilityTable: string }): PlannerPromptMessage {
  const { facetTable, capabilityTable } = params
  const content = [
    'SYSTEM:',
    '',
    'You are the **Flex PlannerService**.  ',
    'Your job is to produce a **valid JSON plan** that exactly matches the following Zod schema.  ',
    'Do not include markdown, explanations, or comments—only the JSON object.',
    '',
    '---',
    '',
    '### SCHEMA DEFINITION',
    '',
    'PlannerDraft = {',
    '  nodes: Array<{',
    '    stage: string',
    '    label?: string',
    '    capabilityId?: string',
    '    derived?: boolean',
    '    kind?: "structuring" | "execution" | "transformation" | "validation"',
    '    inputFacets?: string[] | string | Record<string, unknown>',
    '    outputFacets?: string[] | string | Record<string, unknown>',
    '    rationale?: string | string[]',
    '    instructions?: string | string[]',
    '  }>',
    '  metadata?: { provider?: string; model?: string }',
    '}',
    '',
    '---',
    '',
    '### CONTEXT',
    '',
    'You receive:',
    '1. **Task Envelope:** `[TASK_ENVELOPE]`  ',
    '   - Contains the user’s objective, inputs, policies, special instructions, and output contract.',
    '2. **Facet Catalog Summary:** semantic reference for all known facets.  ',
    '3. **Capability Registry Table:** listing of all available capabilities and their facet coverage.',
    '',
    'Your goal:  ',
    'Create a **minimal PlanGraph** that uses the fewest capabilities necessary to produce all required **output facets** from the envelope, chaining input → output facet flows correctly.',
    '',
    '---',
    '',
    '### FACET CATALOG SUMMARY',
    '',
    facetTable,
    '',
    '---',
    '',
    '### CAPABILITY REGISTRY SUMMARY',
    '',
    capabilityTable,
    '',
    '---',
    '',
    '### PLANNER RULES',
    '',
    '1. **Facet coverage:**  ',
    '   - Every required output facet in the caller’s output contract must be produced by at least one node.  ',
    '   - Every node’s input facets must be either provided by the envelope or produced by an earlier node.  ',
    '',
    '2. **Capability selection:**  ',
    '   - Use only `capabilityId` values listed in the capability table.  ',
    '   - If no capability can satisfy the needed facets, return a diagnostic JSON object explaining the missing facet(s); do not invent placeholder capabilities.  ',
    '',
    '3. **Facet naming:**  ',
    '   - Use facet names *exactly* as listed in the facet catalog.  ',
    '   - Never invent new facet keys or rename existing ones.  ',
    '',
    '4. **Stages:**  ',
    '   - Set `stage` to the pipeline phase the node occupies (e.g., `structuring`, `generation`, `validation`).  ',
    '   - Respect policy directives such as `disallowStages` and `replanAfter`; never leave `stage` blank.  ',
    '',
    '5. **Kinds:**  ',
    '   - Use `structuring` for strategy or brief creation,  ',
    '     `execution` for content or design generation,  ',
    '     `validation` for QA or review  ',
    '',
    '6. **Rationale & instructions:**  ',
    '   - Each node should include a short `"rationale"` explaining *why* it was selected, referencing the facets it consumes and produces.  ',
    '   - Optionally include `"instructions"` (1–2 short imperative sentences) describing how the node should act.  ',
    '',
    '7. **Output requirements:**  ',
    '    - Emit only one top-level JSON object compliant with the schema above.  ',
    '    - No markdown, no explanations, no extra keys.',
    '',
    '---',
    '',
    '### INTERNAL CHECKLIST (for the model)',
    '',
    'Before producing the JSON:',
    ...INTERNAL_CHECKLIST_LINES.map((line) => `${line}  `),
    '',
    '---',
    '',
    '### EXAMPLE REASONING (inline for guidance, not output)',
    '',
    '> Example:  ',
    '> If the objective is to “draft social post copy for LinkedIn” and the envelope already includes a strategist brief (`creative_brief`), then the node `copywriter.SocialpostDrafting` can directly generate `post_copy` from `creative_brief`, `handoff_summary`, and `feedback`.  ',
    '> No strategist or normalization node is needed.',
    '',
    '---',
    '',
    '### OUTPUT INSTRUCTIONS',
    '',
    'After reasoning internally, output only the final JSON object for `PlannerDraft`.  ',
    'Do not include any explanations, commentary, or reasoning text—only valid JSON.'
  ].join('\n')

  return {
    role: 'system' as const,
    content
  }
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\r?\n|\r/g, ' ').trim()
}

function formatMarkdownTable(headers: string[], rows: string[][]): string {
  const headerRow = `| ${headers.join(' | ')} |`
  const separator = `| ${headers.map(() => '---').join(' | ')} |`
  const dataRows = rows.map((row) => `| ${row.join(' | ')} |`)
  return [headerRow, separator, ...dataRows].join('\n')
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function indentBlock(value: string, indent = 2): string {
  const indentation = ' '.repeat(indent)
  return value
    .split('\n')
    .map((line) => `${indentation}${line}`)
    .join('\n')
}

function resolveRelevantPromptContext(
  input: PlannerServiceInput,
  capabilities: CapabilityRecord[],
  facets: FacetDefinition[]
): { facets: Set<string>; capabilities: CapabilityRecord[] } {
  const knownFacets = new Set(facets.map((definition) => definition.name))
  const selectedFacets = new Set<string>()

  const addFacet = (name: string | null | undefined) => {
    if (name && knownFacets.has(name)) {
      selectedFacets.add(name)
    }
  }

  const envelope = input.envelope
  if (envelope.outputContract.mode === 'facets') {
    for (const facet of envelope.outputContract.facets ?? []) {
      addFacet(facet)
    }
  }

  if (envelope.inputs && typeof envelope.inputs === 'object') {
    Object.keys(envelope.inputs).forEach(addFacet)
  }

  if (input.graphContext) {
    input.graphContext.completedNodes.forEach((node) => node.outputFacets.forEach(addFacet))
    input.graphContext.facetValues.forEach((entry) => addFacet(entry.facet))
  }

  const capabilityFacets = (capability: CapabilityRecord): string[] => {
    const facetsInCap = [
      ...(capability.inputFacets ?? []),
      ...(capability.outputFacets ?? [])
    ]
    return facetsInCap.filter((facet) => knownFacets.has(facet))
  }

  const relevantCapabilities: CapabilityRecord[] = []
  if (selectedFacets.size > 0) {
    const seen = new Set<string>()
    let changed = false
    do {
      changed = false
      for (const capability of capabilities) {
        if (seen.has(capability.capabilityId)) continue
        const facetsForCapability = capabilityFacets(capability)
        if (!facetsForCapability.length) continue
        if (facetsForCapability.some((facet) => selectedFacets.has(facet))) {
          seen.add(capability.capabilityId)
          relevantCapabilities.push(capability)
          facetsForCapability.forEach(addFacet)
          changed = true
        }
      }
    } while (changed)
  }

  if (relevantCapabilities.length === 0) {
    const fallback = capabilities.slice(0, MAX_CAPABILITY_ROWS)
    fallback.forEach((capability) => capabilityFacets(capability).forEach(addFacet))
    return { facets: selectedFacets.size > 0 ? selectedFacets : new Set(selectedFacets), capabilities: fallback }
  }

  return { facets: selectedFacets, capabilities: relevantCapabilities }
}

function inferCapabilityKind(capability: CapabilityRecord): 'structuring' | 'execution' | 'validation' | 'transformation' {
  const metadata = (capability.metadata ?? {}) as Record<string, unknown>
  const explicitKind = typeof metadata?.plannerKind === 'string' ? metadata.plannerKind : null
  if (
    explicitKind === 'structuring' ||
    explicitKind === 'execution' ||
    explicitKind === 'validation' ||
    explicitKind === 'transformation'
  ) {
    return explicitKind
  }

  const id = capability.capabilityId.toLowerCase()
  const display = capability.displayName.toLowerCase()
  const summary = capability.summary.toLowerCase()

  if (id.includes('strategy') || id.includes('planner') || display.includes('strateg') || summary.includes('brief')) {
    return 'structuring'
  }
  if (id.includes('review') || id.includes('qa') || summary.includes('review') || display.includes('review')) {
    return 'validation'
  }
  if (id.includes('transform') || summary.includes('transform') || summary.includes('normalize')) {
    return 'transformation'
  }
  return 'execution'
}

export function buildPlannerUserPrompt(params: {
  input: PlannerServiceInput
  capabilities: CapabilityRecord[]
  facets: FacetDefinition[]
}): PlannerUserPromptResult {
  const { input, capabilities, facets } = params
  const context = input.context
  const planningHints = [
    context.channel ? `Primary channel: ${context.channel}` : null,
    context.platform ? `Platform: ${context.platform}` : null,
    context.formats.length ? `Formats: ${context.formats.join(', ')}` : null,
    context.languages.length ? `Languages: ${context.languages.join(', ')}` : null,
    context.audiences.length ? `Audiences: ${context.audiences.join(', ')}` : null,
    context.tags.length ? `Tags: ${context.tags.join(', ')}` : null,
    `Variant count: ${context.variantCount}`
  ].filter((line): line is string => Boolean(line))

  if (Object.keys(context.plannerDirectives).length) {
    planningHints.push(`Planner directives: ${stringifyJson(context.plannerDirectives)}`)
  }

  const { facets: relevantFacetNames, capabilities: relevantCapabilities } = resolveRelevantPromptContext(
    input,
    capabilities,
    facets
  )

  const orderedFacetDefinitions = facets.filter((definition) => relevantFacetNames.has(definition.name))
  const facetRowsTotal = orderedFacetDefinitions.length
  const facetDefinitionsToUse =
    orderedFacetDefinitions.length > 0 ? orderedFacetDefinitions.slice(0, MAX_FACET_ROWS) : facets.slice(0, MAX_FACET_ROWS)

  const facetRows = facetDefinitionsToUse.map((definition) => {
    const direction = definition.metadata?.direction ?? 'unknown'
    return [
      escapeTableCell(definition.name),
      escapeTableCell(String(direction)),
      escapeTableCell(definition.description ?? definition.semantics?.summary ?? '')
    ]
  })

  const facetTable = formatMarkdownTable(['Facet', 'Direction', 'Description'], facetRows)

  const capabilityRowsTotal = relevantCapabilities.length || capabilities.length
  const capabilityDefinitionsToUse = (relevantCapabilities.length ? relevantCapabilities : capabilities).slice(
    0,
    MAX_CAPABILITY_ROWS
  )

  const capabilityRows = capabilityDefinitionsToUse.map((capability) => {
    const inputFacets = capability.inputFacets?.length ? capability.inputFacets.join(', ') : '—'
    const outputFacets = capability.outputFacets?.length ? capability.outputFacets.join(', ') : '—'
    return [
      escapeTableCell(capability.capabilityId),
      escapeTableCell(capability.displayName),
      escapeTableCell(inferCapabilityKind(capability)),
      escapeTableCell(inputFacets),
      escapeTableCell(outputFacets),
      escapeTableCell(capability.summary)
    ]
  })

  const capabilityTable = formatMarkdownTable(
    ['Capability ID', 'Display Name', 'Kind', 'Input Facets', 'Output Facets', 'Summary'],
    capabilityRows
  )

  const envelopeSections: string[] = [`Objective: ${context.objective}`]

  if (planningHints.length) {
    envelopeSections.push('Planning hints:\n' + planningHints.map((line) => `- ${line}`).join('\n'))
  }

  envelopeSections.push('Policies:\n' + indentBlock(stringifyJson(input.policies)))

  if (input.policyMetadata?.legacyNotes?.length) {
    envelopeSections.push(`Legacy policy notes: ${input.policyMetadata.legacyNotes.join('; ')}`)
  }
  if (input.policyMetadata?.legacyFields?.length) {
    envelopeSections.push(`Legacy policy fields: ${input.policyMetadata.legacyFields.join(', ')}`)
  }

  if (input.envelope.inputs) {
    envelopeSections.push('Inputs:\n' + indentBlock(stringifyJson(input.envelope.inputs)))
  }

  if (context.specialInstructions.length || input.envelope.specialInstructions?.length) {
    const instructions = context.specialInstructions.length ? context.specialInstructions : input.envelope.specialInstructions ?? []
    envelopeSections.push('Special instructions:\n' + instructions.map((line) => `- ${line}`).join('\n'))
  }

  envelopeSections.push('Output contract:\n' + indentBlock(stringifyJson(input.envelope.outputContract)))

  const sections: string[] = []
  sections.push('### TASK ENVELOPE', envelopeSections.join('\n\n'))

  const graphSections: string[] = []
  if (input.graphContext?.completedNodes.length) {
    const nodeLines = input.graphContext.completedNodes.map((node) => {
      const capability = node.capabilityId ?? 'virtual'
      const facetsList = node.outputFacets.length ? node.outputFacets.join(', ') : 'none'
      return `- ${node.label} (${node.nodeId}) → capability=${capability} | output facets=${facetsList}`
    })
    graphSections.push('Completed nodes already executed:\n' + nodeLines.join('\n'))
  }

  if (input.graphContext?.facetValues.length) {
    const recentValues = input.graphContext.facetValues.slice(-MAX_GRAPH_FACET_ENTRIES)
    const facetValueLines = recentValues.map((entry) => {
      const serialized = serializeFacetValue(entry.value)
      const capability = entry.sourceCapabilityId ?? 'virtual'
      return `- ${entry.facet} (from ${entry.sourceLabel} / ${entry.sourceNodeId} :: capability=${capability}):\n${indentBlock(serialized)}`
    })
    graphSections.push(
      `Facet values from completed nodes (values truncated to ${MAX_FACET_VALUE_LENGTH} characters when needed):\n${facetValueLines.join(
        '\n'
      )}`
    )
  }

  if (graphSections.length) {
    sections.push('### CURRENT GRAPH CONTEXT', graphSections.join('\n\n'))
  }

  sections.push('### INTERNAL CHECKLIST REMINDER', INTERNAL_CHECKLIST_LINES.join('\n'))
  sections.push(
    '### OUTPUT FORMAT',
    'Return only the final JSON object for `PlannerDraft`. No commentary, markdown, or extra keys.'
  )

  return {
    message: {
      role: 'user' as const,
      content: sections.join('\n\n')
    },
    facetRowCount: facetRows.length,
    capabilityRowCount: capabilityRows.length,
    facetTable,
    capabilityTable
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
  private readonly telemetry: PlannerTelemetry

  constructor(
    capabilityRegistry: FlexCapabilityRegistryService = getFlexCapabilityRegistryService(),
    options?: { timeoutMs?: number; client?: OpenAI; model?: string; telemetry?: PlannerTelemetry }
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
    this.telemetry = options?.telemetry ?? getTelemetryService()
  }

  async proposePlan(input: PlannerServiceInput): Promise<PlannerDraft> {
    const catalog = getFacetCatalog()
    const facetDefinitions = catalog.list()
    const capabilitySnapshot =
      input.capabilities.length > 0 ? input.capabilities : (await this.capabilityRegistry.getSnapshot()).active
    const userPrompt = buildPlannerUserPrompt({
      input,
      capabilities: capabilitySnapshot,
      facets: facetDefinitions
    })
    const systemMessage = buildPlannerSystemPrompt({
      facetTable: userPrompt.facetTable,
      capabilityTable: userPrompt.capabilityTable
    })
    const userMessage = userPrompt.message

    this.telemetry.recordPlannerPromptSize({
      systemCharacters: systemMessage.content.length,
      userCharacters: userMessage.content.length,
      facetRows: userPrompt.facetRowCount,
      capabilityRows: userPrompt.capabilityRowCount
    })

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
        getLogger().warn('flex_planner_failure', {
          reason: error instanceof Error ? error.message : String(error)
        })
      } catch {}
      throw error
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

}
