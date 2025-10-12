import Ajv from 'ajv'
import type { FlexPlan, FlexPlanNode } from './flex-planner'
import type {
  TaskEnvelope,
  FlexEvent,
  OutputContract,
  HitlRunState,
  HitlRequestRecord,
  HitlRequestPayload
} from '@awesomeposter/shared'
import { FlexRunPersistence } from './orchestrator-persistence'
import { withHitlContext } from './hitl-context'
import type { HitlService } from './hitl-service'

export type FlexExecutionOptions = {
  onEvent: (event: FlexEvent) => Promise<void>
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
  private readonly ajv: Ajv

  constructor(
    private readonly persistence = new FlexRunPersistence(),
    options?: { ajv?: Ajv }
  ) {
    this.ajv = options?.ajv ?? new Ajv({ allErrors: true, strict: false })
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
      await opts.onEvent(this.buildEvent('node_start', {
        nodeId: node.id,
        capabilityId: node.capabilityId,
        label: node.label,
        startedAt: startedAt.toISOString()
      }))

      try {
        const result = await this.executeCapability(node, envelope)
        nodeOutputs.set(node.id, result.output)
        const completedAt = new Date()
        await this.persistence.markNode(runId, node.id, {
          status: 'completed',
          output: result.output,
          completedAt
        })
        await opts.onEvent(this.buildEvent('node_complete', {
          nodeId: node.id,
          capabilityId: node.capabilityId,
          label: node.label,
          completedAt: completedAt.toISOString(),
          output: result.output
        }))
      } catch (err) {
        const errorAt = new Date()
        await this.persistence.markNode(runId, node.id, {
          status: 'error',
          error: this.serializeError(err),
          completedAt: errorAt
        })
        await opts.onEvent(this.buildEvent('node_error', {
          nodeId: node.id,
          capabilityId: node.capabilityId,
          label: node.label,
          error: this.serializeError(err)
        }))
        throw err
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

    const validation = await this.validateOutput(envelope.outputContract, finalOutput)
    if (!validation.ok) {
      await opts.onEvent(this.buildEvent('validation_error', {
        errors: validation.errors
      }))
      throw new Error('Output validation failed')
    }

    await this.persistence.recordResult(runId, finalOutput)
    await opts.onEvent(this.buildEvent('complete', {
      output: finalOutput
    }))
    return finalOutput
  }

  private async executeCapability(node: FlexPlanNode, envelope: TaskEnvelope): Promise<CapabilityResult> {
    switch (node.capabilityId) {
      case 'mock.copywriter.linkedinVariants':
        return { output: this.runLinkedinStub(node, envelope) }
      default:
        throw new Error(`Unsupported capability ${node.capabilityId}`)
    }
  }

  private runLinkedinStub(node: FlexPlanNode, envelope: TaskEnvelope): Record<string, unknown> {
    const inputs = (node.bundle.inputs ?? {}) as Record<string, unknown>
    const variantCount = Number(inputs.variantCount || 2)
    const profile = this.pickCompanyProfile(inputs)
    const goal = String(inputs.goal ?? envelope.objective ?? '')

    const variants = Array.from({ length: Math.max(1, Math.min(variantCount, 5)) }, (_, idx) => {
      const tone = String(inputs.tone ?? inputs.brandVoice ?? 'inspiring')
      const focus = idx === 0 ? 'team culture' : 'career growth'
      const companyName = profile.companyName || 'AwesomePoster'
      return {
        headline: `${companyName} ${focus === 'team culture' ? 'Teams Thrive Together' : 'Is Hiring DX Builders'}`,
        body: [
          `${companyName} just wrapped an unforgettable ${profile.recentEvent || 'team retreat'}.`,
          `We are building human-first automation for developer experience and want teammates who care about ${focus}.`
        ].join(' '),
        callToAction: focus === 'team culture' ? 'Join the Adventure' : 'Apply Today',
        tone
      }
    })

    return { variants }
  }

  private pickCompanyProfile(inputs: Record<string, unknown>): Record<string, string> {
    const bundle = Array.isArray(inputs.contextBundles) ? inputs.contextBundles : []
    const profile = bundle.find((entry: any) => entry && entry.type === 'company_profile')
    if (profile && typeof profile.payload === 'object' && profile.payload) {
      return profile.payload as Record<string, string>
    }
    if (typeof inputs.companyProfile === 'object' && inputs.companyProfile) {
      return inputs.companyProfile as Record<string, string>
    }
    return {}
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
      variants.length ? `Generated ${variants.length} variant${variants.length === 1 ? '' : 's'} for review.` : 'No structured variants detected.'
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

  private async validateOutput(contract: OutputContract, output: Record<string, unknown>) {
    if (contract.mode === 'json_schema') {
      const validator = this.ajv.compile(contract.schema as Record<string, unknown>)
      const ok = validator(output)
      if (ok) return { ok: true as const }
      return {
        ok: false as const,
        errors: (validator.errors || []).map((err) => ({
          message: err.message,
          instancePath: err.instancePath,
          keyword: err.keyword,
          params: err.params
        }))
      }
    }
    return { ok: true as const }
  }

  private serializeError(err: unknown): Record<string, unknown> {
    if (err instanceof Error) {
      return {
        message: err.message,
        name: err.name,
        stack: err.stack
      }
    }
    return { message: String(err) }
  }

  private buildEvent(type: FlexEvent['type'], payload: Record<string, unknown>): FlexEvent {
    return {
      type,
      timestamp: new Date().toISOString(),
      payload
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
      await opts.onEvent(this.buildEvent('node_start', {
        nodeId: terminalNode.id,
        capabilityId: terminalNode.capabilityId,
        label: terminalNode.label,
        startedAt: startAt.toISOString()
      }))

      const completedAt = new Date()
      await this.persistence.markNode(runId, terminalNode.id, {
        status: 'completed',
        output: finalOutput,
        completedAt
      })
      await opts.onEvent(this.buildEvent('node_complete', {
        nodeId: terminalNode.id,
        capabilityId: terminalNode.capabilityId,
        label: terminalNode.label,
        completedAt: completedAt.toISOString(),
        output: finalOutput
      }))
    }

    const validation = await this.validateOutput(envelope.outputContract, finalOutput)
    if (!validation.ok) {
      await opts.onEvent(this.buildEvent('validation_error', {
        errors: validation.errors
      }))
      throw new Error('Output validation failed')
    }

    await this.persistence.recordResult(runId, finalOutput)
    await opts.onEvent(this.buildEvent('complete', {
      output: finalOutput
    }))
    return finalOutput
  }
}
