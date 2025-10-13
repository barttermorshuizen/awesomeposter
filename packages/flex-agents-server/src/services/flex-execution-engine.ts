import Ajv, { type ErrorObject } from 'ajv'
import { z } from 'zod'
import type { FlexPlan, FlexPlanNode } from './flex-planner'
import { CONTENT_CAPABILITY_ID } from '../agents/content-generator'
import type {
  TaskEnvelope,
  FlexEvent,
  OutputContract,
  HitlRunState,
  HitlRequestRecord,
  HitlRequestPayload,
  CapabilityRecord,
  CapabilityContract
} from '@awesomeposter/shared'
import { FlexRunPersistence } from './orchestrator-persistence'
import { withHitlContext } from './hitl-context'
import type { HitlService } from './hitl-service'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getAgents } from './agents-container'
import type { AgentRuntime } from './agent-runtime'
import { getLogger } from './logger'

type StructuredRuntime = Pick<AgentRuntime, 'runStructured'>
type AjvInstance = ReturnType<typeof Ajv>
type AjvValidateFn = ReturnType<AjvInstance['compile']>

class FlexValidationError extends Error {
  constructor(
    message: string,
    public readonly scope: 'capability_input' | 'capability_output' | 'final_output' | 'envelope',
    public readonly errors: ErrorObject[]
  ) {
    super(message)
    this.name = 'FlexValidationError'
  }
}

export type FlexExecutionOptions = {
  onEvent: (event: FlexEvent) => Promise<void>
  correlationId?: string
  hitl?: {
    service: HitlService
    state: HitlRunState
    threadId?: string | null
    limit: { current: number; max: number }
    onRequest?: (record: HitlRequestRecord, state: HitlRunState) => void | Promise<void>
    onDenied?: (reason: string, state: HitlRunState) => void | Promise<void>
    updateState?: (state: HitlRunState) => void
  }
}

type CapabilityResult = {
  output: Record<string, unknown>
}

export class HitlPauseError extends Error {
  constructor(message = 'Awaiting HITL approval') {
    super(message)
    this.name = 'HitlPauseError'
  }
}

export class FlexExecutionEngine {
  private readonly ajv: AjvInstance
  private readonly validatorCache = new Map<string, AjvValidateFn>()
  private readonly runtime: StructuredRuntime
  private readonly capabilityRegistry: FlexCapabilityRegistryService

  constructor(
    private readonly persistence = new FlexRunPersistence(),
    options?: {
      ajv?: AjvInstance
      runtime?: StructuredRuntime
      capabilityRegistry?: FlexCapabilityRegistryService
    }
  ) {
    this.ajv = options?.ajv ?? new Ajv({ allErrors: true })
    this.runtime = options?.runtime ?? getAgents().runtime
    this.capabilityRegistry = options?.capabilityRegistry ?? getFlexCapabilityRegistryService()
  }

  async execute(runId: string, envelope: TaskEnvelope, plan: FlexPlan, opts: FlexExecutionOptions) {
    const nodeOutputs = new Map<string, Record<string, unknown>>()

    for (const node of plan.nodes) {
      const startedAt = new Date()
      await this.persistence.markNode(runId, node.id, {
        status: 'running',
        capabilityId: node.capabilityId,
        label: node.label,
        context: node.bundle,
        startedAt
      })
      try {
        getLogger().info('flex_node_start', {
          runId,
          nodeId: node.id,
          capabilityId: node.capabilityId,
          correlationId: opts.correlationId
        })
      } catch {}
      await opts.onEvent(
        this.buildEvent(
          'node_start',
          {
            capabilityId: node.capabilityId,
            label: node.label,
            startedAt: startedAt.toISOString()
          },
          { runId, nodeId: node.id }
        )
      )

      try {
        const result = await this.invokeCapability(runId, node, envelope, opts)
        nodeOutputs.set(node.id, result.output)

        const completedAt = new Date()
        await this.persistence.markNode(runId, node.id, {
          status: 'completed',
          output: result.output,
          completedAt
        })
        try {
          getLogger().info('flex_node_complete', {
            runId,
            nodeId: node.id,
            capabilityId: node.capabilityId,
            correlationId: opts.correlationId
          })
        } catch {}
        await opts.onEvent(
          this.buildEvent(
            'node_complete',
            {
              capabilityId: node.capabilityId,
              label: node.label,
              completedAt: completedAt.toISOString(),
              output: result.output
            },
            { runId, nodeId: node.id }
          )
        )
      } catch (error) {
        const errorAt = new Date()
        const serialized = this.serializeError(error)
        await this.persistence.markNode(runId, node.id, {
          status: 'error',
          error: serialized,
          completedAt: errorAt
        })
        try {
          getLogger().error('flex_node_error', {
            runId,
            nodeId: node.id,
            capabilityId: node.capabilityId,
            correlationId: opts.correlationId,
            error: serialized.message ?? serialized.name ?? 'unknown_error'
          })
        } catch {}
        await opts.onEvent(
          this.buildEvent(
            'node_error',
            {
              capabilityId: node.capabilityId,
              label: node.label,
              error: serialized
            },
            { runId, nodeId: node.id, message: serialized.message as string | undefined }
          )
        )
        throw error
      }
    }

    const finalOutput = this.composeFinalOutput(plan, nodeOutputs)

    if (this.requiresHitlApproval(envelope)) {
      const hitl = opts.hitl
      if (!hitl) {
        throw new Error('HITL context unavailable for flex run')
      }
      const terminalNode = plan.nodes[plan.nodes.length - 1]
      if (!terminalNode) {
        throw new Error('No terminal node available for HITL approval')
      }

      let latestState = hitl.state
      let pendingRecord: HitlRequestRecord | null = null
      await this.persistence.recordPendingResult(runId, finalOutput)

      await withHitlContext(
        {
          runId,
          threadId: hitl.threadId ?? undefined,
          stepId: terminalNode.id,
          capabilityId: terminalNode.capabilityId,
          hitlService: hitl.service,
          limit: hitl.limit,
          onRequest: (record, state) => {
            pendingRecord = record
            latestState = state
          },
          onDenied: async (reason, state) => {
            latestState = state
            if (hitl.onDenied) await hitl.onDenied(reason, state)
          },
          snapshot: hitl.state
        },
        async () => {
          const payload = this.buildHitlPayload(envelope, finalOutput)
          const result = await hitl.service.raiseRequest(payload)
          if (result.status === 'denied') {
            throw new Error(result.reason || 'HITL request denied')
          }
        }
      )

      if (latestState !== hitl.state) {
        hitl.state = latestState
        hitl.updateState?.(latestState)
      }

      if (pendingRecord) {
        await this.persistence.markNode(runId, terminalNode.id, {
          status: 'awaiting_hitl',
          context: terminalNode.bundle
        })
        await this.persistence.updateStatus(runId, 'awaiting_hitl')
        if (hitl.onRequest) {
          await hitl.onRequest(pendingRecord, latestState)
        }
        throw new HitlPauseError()
      }
    }

    await this.ensureOutputMatchesContract(
      envelope.outputContract,
      finalOutput,
      { scope: 'final_output', runId },
      opts
    )

    await this.persistence.recordResult(runId, finalOutput)
    await opts.onEvent(this.buildEvent('complete', { output: finalOutput }, { runId }))
    return finalOutput
  }

  private async invokeCapability(
    runId: string,
    node: FlexPlanNode,
    envelope: TaskEnvelope,
    opts: FlexExecutionOptions
  ): Promise<CapabilityResult> {
    const capability = await this.resolveCapability(node.capabilityId)
    await this.validateCapabilityInputs(capability, node, runId, opts)
    try {
      getLogger().info('flex_capability_dispatch_start', {
        runId,
        nodeId: node.id,
        capabilityId: capability.capabilityId,
        correlationId: opts.correlationId
      })
    } catch {}
    const result = await this.dispatchCapability(capability, node, envelope)
    try {
      getLogger().info('flex_capability_dispatch_complete', {
        runId,
        nodeId: node.id,
        capabilityId: capability.capabilityId,
        correlationId: opts.correlationId
      })
    } catch {}
    const contract = capability.outputContract ?? capability.defaultContract
    if (contract) {
      await this.ensureOutputMatchesContract(
        contract,
        result.output,
        { scope: 'capability_output', runId, nodeId: node.id },
        opts
      )
    }
    return result
  }

  private async resolveCapability(capabilityId: string): Promise<CapabilityRecord> {
    const capability = await this.capabilityRegistry.getCapabilityById(capabilityId)
    if (capability && capability.status === 'active') {
      return capability
    }
    if (capabilityId === 'mock.copywriter.linkedinVariants') {
      const fallback = await this.capabilityRegistry.getCapabilityById(CONTENT_CAPABILITY_ID)
      if (fallback && fallback.status === 'active') {
        return fallback
      }
    }
    throw new Error(`Capability ${capabilityId} not registered or inactive`)
  }

  private async validateCapabilityInputs(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    runId: string,
    opts: FlexExecutionOptions
  ) {
    const metadata = (capability.metadata ?? {}) as Record<string, unknown>
    const legacySchema = metadata.inputSchema
    const contract: CapabilityContract | undefined =
      capability.inputContract ??
      (legacySchema && typeof legacySchema === 'object'
        ? ({ mode: 'json_schema', schema: legacySchema } as CapabilityContract)
        : undefined)

    if (contract?.mode !== 'json_schema') return

    await this.validateSchema(
      contract.schema as Record<string, unknown>,
      node.bundle.inputs ?? {},
      { scope: 'capability_input', runId, nodeId: node.id },
      opts
    )
  }

  private async dispatchCapability(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    envelope: TaskEnvelope
  ): Promise<CapabilityResult> {
    switch (capability.capabilityId) {
      case CONTENT_CAPABILITY_ID:
      case 'mock.copywriter.linkedinVariants':
        return this.executeLinkedinVariants(capability, node, envelope)
      default:
        throw new Error(`Unsupported capability ${capability.capabilityId}`)
    }
  }

  private async executeLinkedinVariants(
    capability: CapabilityRecord,
    node: FlexPlanNode,
    envelope: TaskEnvelope
  ): Promise<CapabilityResult> {
    const inputs = (node.bundle.inputs ?? {}) as Record<string, unknown>
    const requestedCount = inputs.variantCount ?? (envelope.inputs as Record<string, unknown> | undefined)?.variantCount
    const variantCount = this.normalizeVariantCount(requestedCount)
    const boundedCount = Math.max(1, Math.min(variantCount, 5))

    const schema = z.object({
      variants: z
        .array(
          z.object({
            headline: z.string().min(5),
            body: z.string().min(20),
            callToAction: z.string().min(2)
          })
        )
        .min(boundedCount)
        .max(boundedCount)
    })

    const companyProfile = this.extractCompanyProfile(inputs)
    const policies = (envelope.policies ?? {}) as Record<string, unknown>
    const tone =
      String(inputs.brandVoice ?? inputs.tone ?? policies.brandVoice ?? '')
        .trim()
        .toLowerCase() || 'professional'

    const messages = this.buildLinkedinMessages({
      envelope,
      variantCount: boundedCount,
      tone,
      companyProfile,
      instructions: node.bundle.instructions ?? [],
      inputs
    })

    try {
      const key = process.env.FLEX_OPENAI_API_KEY || process.env.OPENAI_API_KEY || ''
      getLogger().info('flex_openai_key_preview', {
        hasKey: Boolean(key),
        prefix: key ? `${key.slice(0, 6)}***` : null
      })
    } catch {}

    const output = await this.runtime.runStructured(schema, messages, { schemaName: 'FlexLinkedInVariants' })
    return { output: output as Record<string, unknown> }
  }

  private buildLinkedinMessages(args: {
    envelope: TaskEnvelope
    variantCount: number
    tone: string
    companyProfile: Record<string, unknown>
    instructions: string[]
    inputs: Record<string, unknown>
  }) {
    const { envelope, variantCount, tone, companyProfile, instructions, inputs } = args
    const sections: string[] = []

    sections.push(`Objective: ${envelope.objective}`)

    const goal =
      inputs.goal ??
      (typeof (envelope.inputs as Record<string, unknown> | undefined)?.goal !== 'undefined'
        ? (envelope.inputs as Record<string, unknown> | undefined)?.goal
        : undefined)
    if (goal) sections.push(`Goal: ${String(goal)}`)
    if (inputs.audience) sections.push(`Audience: ${String(inputs.audience)}`)
    sections.push(`Tone: ${tone}`)

    const profileSummary = this.describeCompanyProfile(companyProfile)
    if (profileSummary) {
      sections.push(profileSummary)
    }

    const contextBundles = Array.isArray(inputs.contextBundles) ? inputs.contextBundles : []
    const extraBundles = contextBundles
      .filter((bundle: any) => bundle && bundle.type && bundle.type !== 'company_profile')
      .map((bundle: any) => {
        const descriptor = typeof bundle.type === 'string' ? bundle.type : 'context'
        const payload = bundle.payload ?? bundle.value ?? bundle
        return `Context bundle (${descriptor}): ${JSON.stringify(payload)}`
      })
    if (extraBundles.length) {
      sections.push(extraBundles.join('\n'))
    }

    if (instructions.length) {
      sections.push(
        ['Special instructions:']
          .concat(instructions.map((instruction) => `- ${instruction}`))
          .join('\n')
      )
    }

    sections.push(`Produce ${variantCount} LinkedIn post variant${variantCount === 1 ? '' : 's'} as JSON.`)

    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      {
        role: 'system',
        content: [
          'You are a marketing copywriter generating LinkedIn post variants.',
          `Return a JSON object with a "variants" array containing exactly ${variantCount} entries.`,
          'Each variant must include "headline", "body", and "callToAction" fields with polished copy.',
          'Do not include markdown fences or commentary—return JSON only.'
        ].join('\n')
      },
      {
        role: 'user',
        content: sections.join('\n\n')
      }
    ]

    return messages
  }

  private describeCompanyProfile(profile: Record<string, unknown>): string | null {
    const entries = Object.entries(profile).filter(
      ([, value]) => typeof value === 'string' && value.trim().length > 0
    )
    if (!entries.length) return null
    const humanize = (key: string) =>
      key
        .replace(/([A-Z])/g, ' $1')
        .replace(/[_\s]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (ch) => ch.toUpperCase())
    const lines = entries.map(([key, value]) => `- ${humanize(key)}: ${String(value)}`)
    return ['Company profile:', ...lines].join('\n')
  }

  private extractCompanyProfile(inputs: Record<string, unknown>): Record<string, unknown> {
    const bundles = Array.isArray(inputs.contextBundles) ? inputs.contextBundles : []
    const profileBundle = bundles.find((entry: any) => entry && entry.type === 'company_profile')
    if (profileBundle && typeof profileBundle.payload === 'object' && profileBundle.payload) {
      return profileBundle.payload as Record<string, unknown>
    }
    if (typeof inputs.companyProfile === 'object' && inputs.companyProfile) {
      return inputs.companyProfile as Record<string, unknown>
    }
    return {}
  }

  private normalizeVariantCount(raw: unknown): number {
    const num = Number(raw)
    if (!Number.isFinite(num)) return 2
    const clamped = Math.floor(num)
    if (clamped < 1) return 1
    if (clamped > 5) return 5
    return clamped
  }

  private composeFinalOutput(plan: FlexPlan, nodeOutputs: Map<string, Record<string, unknown>>) {
    if (!plan.nodes.length) return {}
    const lastNode = plan.nodes[plan.nodes.length - 1]
    return nodeOutputs.get(lastNode.id) ?? {}
  }

  private buildHitlPayload(envelope: TaskEnvelope, finalOutput: Record<string, unknown>): HitlRequestPayload {
    const variants = Array.isArray((finalOutput as any)?.variants) ? (finalOutput as any).variants : []
    const objective = (envelope.objective || '').trim()
    const summaryLines = [
      objective ? `Objective: ${objective}` : null,
      variants.length
        ? `Generated ${variants.length} variant${variants.length === 1 ? '' : 's'} for review.`
        : 'No structured variants detected.'
    ].filter(Boolean) as string[]

    return {
      question: 'Review generated flex run output and approve before completing the request.',
      kind: 'approval',
      options: [
        { id: 'approve', label: 'Approve output' },
        { id: 'revise', label: 'Request revisions' }
      ],
      allowFreeForm: true,
      urgency: 'normal',
      additionalContext: summaryLines.join(' ')
    }
  }

  private requiresHitlApproval(envelope: TaskEnvelope): boolean {
    const policies = (envelope.policies ?? {}) as Record<string, unknown>
    if (typeof policies.requiresHitlApproval === 'boolean') {
      return policies.requiresHitlApproval
    }
    const constraints = (envelope.constraints ?? {}) as Record<string, unknown>
    if (typeof constraints.requiresHitlApproval === 'boolean') {
      return constraints.requiresHitlApproval
    }
    return false
  }

  private async ensureOutputMatchesContract(
    contract: OutputContract,
    output: Record<string, unknown>,
    context: { scope: 'capability_output' | 'final_output'; runId: string; nodeId?: string },
    opts: FlexExecutionOptions
  ) {
    if (contract.mode !== 'json_schema') return
    await this.validateSchema(contract.schema as Record<string, unknown>, output, context, opts)
  }

  private getValidator(schema: Record<string, unknown>) {
    const key = JSON.stringify(schema)
    let validator = this.validatorCache.get(key)
    if (!validator) {
      validator = this.ajv.compile(JSON.parse(key))
      this.validatorCache.set(key, validator)
    }
    return validator
  }

  private async validateSchema(
    schema: Record<string, unknown>,
    data: unknown,
    context: { scope: 'capability_input' | 'capability_output' | 'final_output'; runId: string; nodeId?: string },
    opts: FlexExecutionOptions
  ) {
    const validator = this.getValidator(schema)
    const ok = validator(data)
    if (ok) return
    const errors = (validator.errors || []) as ErrorObject[]
    await this.emitValidationError(errors, context, opts)
    throw new FlexValidationError(`${context.scope} validation failed`, context.scope, errors)
  }

  private mapAjvErrors(errors: ErrorObject[]) {
    return errors.map((err) => ({
      message: err.message,
      instancePath: (err as any).instancePath ?? err.dataPath ?? '',
      keyword: err.keyword,
      params: err.params ?? {},
      schemaPath: err.schemaPath
    }))
  }

  private async emitValidationError(
    errors: ErrorObject[],
    context: { scope: 'capability_input' | 'capability_output' | 'final_output'; runId: string; nodeId?: string },
    opts: FlexExecutionOptions
  ) {
    const normalized = this.mapAjvErrors(errors)
    try {
      getLogger().warn('flex_validation_failed', {
        runId: context.runId,
        nodeId: context.nodeId,
        scope: context.scope,
        errorCount: normalized.length
      })
    } catch {}
    await opts.onEvent(
      this.buildEvent(
        'validation_error',
        {
          scope: context.scope,
          errors: normalized
        },
        { runId: context.runId, nodeId: context.nodeId }
      )
    )
  }

  private serializeError(err: unknown): Record<string, unknown> {
    if (err instanceof FlexValidationError) {
      return {
        message: err.message,
        name: err.name,
        scope: err.scope,
        errors: this.mapAjvErrors(err.errors)
      }
    }
    if (err instanceof Error) {
      return {
        message: err.message,
        name: err.name,
        stack: err.stack
      }
    }
    return { message: String(err) }
  }

  private buildEvent(
    type: FlexEvent['type'],
    payload: Record<string, unknown>,
    meta?: { runId?: string; nodeId?: string; message?: string }
  ): FlexEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      payload,
      runId: meta?.runId,
      nodeId: meta?.nodeId,
      message: meta?.message
    }
  }

  async resumePending(
    runId: string,
    envelope: TaskEnvelope,
    plan: FlexPlan,
    finalOutput: Record<string, unknown>,
    opts: FlexExecutionOptions
  ) {
    const terminalNode = plan.nodes[plan.nodes.length - 1]
    if (terminalNode) {
      const startAt = new Date()
      await this.persistence.markNode(runId, terminalNode.id, {
        status: 'running',
        startedAt: startAt
      })
      await opts.onEvent(
        this.buildEvent(
          'node_start',
          {
            capabilityId: terminalNode.capabilityId,
            label: terminalNode.label,
            startedAt: startAt.toISOString()
          },
          { runId, nodeId: terminalNode.id }
        )
      )

      const completedAt = new Date()
      await this.persistence.markNode(runId, terminalNode.id, {
        status: 'completed',
        output: finalOutput,
        completedAt
      })
      await opts.onEvent(
        this.buildEvent(
          'node_complete',
          {
            capabilityId: terminalNode.capabilityId,
            label: terminalNode.label,
            completedAt: completedAt.toISOString(),
            output: finalOutput
          },
          { runId, nodeId: terminalNode.id }
        )
      )
    }

    await this.ensureOutputMatchesContract(
      envelope.outputContract,
      finalOutput,
      { scope: 'final_output', runId },
      opts
    )

    await this.persistence.recordResult(runId, finalOutput)
    await opts.onEvent(this.buildEvent('complete', { output: finalOutput }, { runId }))
    return finalOutput
  }
}
