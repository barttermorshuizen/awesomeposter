import { createHash } from 'node:crypto'
import type { TaskEnvelope, FlexEvent, HitlRunState, HitlRequestRecord, OutputContract, ContextBundle, NodeContract } from '@awesomeposter/shared'
import { genCorrelationId, getLogger } from './logger'
import { FlexRunPersistence, type FlexPlanNodeSnapshot, type FlexRunRecord } from './orchestrator-persistence'
import { FlexPlanner, type FlexPlan } from './flex-planner'
import { FlexExecutionEngine, HitlPauseError } from './flex-execution-engine'
import { getHitlService, type HitlService } from './hitl-service'

type RunOptions = {
  onEvent: (event: FlexEvent) => Promise<void>
  correlationId?: string
}

function schemaHash(contract: TaskEnvelope['outputContract']): string | null {
  if (!contract) return null
  try {
    if (contract.mode === 'json_schema') {
      const hash = createHash('sha256')
      hash.update(JSON.stringify(contract.schema))
      return hash.digest('hex').slice(0, 16)
    }
  } catch (err) {
    getLogger().warn('flex_schema_hash_failed', { err: err instanceof Error ? err.message : String(err) })
  }
  return null
}

function resolveThreadId(envelope: TaskEnvelope): string | null {
  const metadata = envelope.metadata ?? {}
  const constraints = (envelope.constraints ?? {}) as Record<string, unknown>
  if (typeof metadata?.threadId === 'string') return metadata.threadId
  if (typeof constraints?.threadId === 'string') return constraints.threadId
  if (typeof constraints?.resumeThreadId === 'string') return constraints.resumeThreadId as string
  if (typeof (envelope as any).threadId === 'string') return (envelope as any).threadId
  if (typeof metadata?.correlationId === 'string') return metadata.correlationId
  return null
}

type RunResult = {
  runId: string
  status: 'completed' | 'awaiting_hitl' | 'failed'
  output: Record<string, unknown> | null
}

export class FlexRunCoordinator {
  constructor(
    private readonly persistence = new FlexRunPersistence(),
    private readonly planner = new FlexPlanner(),
    private readonly engine = new FlexExecutionEngine(),
    private readonly hitlService: HitlService = getHitlService()
  ) {}

  async run(envelope: TaskEnvelope, opts: RunOptions): Promise<RunResult> {
    const metadata = (envelope.metadata ?? {}) as Record<string, unknown>
    const constraints = (envelope.constraints ?? {}) as Record<string, unknown>
    const providedRunId = typeof constraints?.resumeRunId === 'string'
      ? (constraints.resumeRunId as string)
      : typeof metadata?.runId === 'string'
      ? metadata.runId
      : null
    const providedThreadId = resolveThreadId(envelope)

    let existing = providedRunId ? await this.persistence.loadFlexRun(providedRunId) : null
    if (!existing && providedThreadId) {
      existing = await this.persistence.findFlexRunByThreadId(providedThreadId)
    }

    const runId = existing?.run.runId ?? `flex_${genCorrelationId()}`
    const threadId = providedThreadId ?? existing?.run.threadId ?? null
    const envelopeToUse = existing ? existing.run.envelope : envelope
    const schemaHashValue = schemaHash(envelopeToUse.outputContract)

    if (!existing) {
      await this.persistence.createOrUpdateRun({
        runId,
        envelope: envelopeToUse,
        status: 'pending',
        threadId,
        objective: envelopeToUse.objective,
        schemaHash: schemaHashValue,
        metadata: (envelopeToUse.metadata ?? {}) as Record<string, unknown> | null
      })
    }

    let hitlState: HitlRunState = await this.hitlService.loadRunState(runId)
    const hitlLimit = {
      current: hitlState.requests.filter((r) => r.status !== 'denied').length,
      max: this.hitlService.getMaxRequestsPerRun()
    }
    const updateHitlState = (state: HitlRunState) => {
      hitlState = state
      hitlLimit.current = state.requests.filter((r) => r.status !== 'denied').length
    }
    const signalHitlRequest = async (record: HitlRequestRecord, state: HitlRunState) => {
      updateHitlState(state)
      await opts.onEvent({
        type: 'hitl_request',
        timestamp: new Date().toISOString(),
        runId,
        nodeId: record.stepId ?? undefined,
        payload: {
          request: {
            id: record.id,
            originAgent: record.originAgent,
            payload: record.payload,
            createdAt: record.createdAt
          }
        }
      })
    }
    const signalHitlDenied = async (reason: string, state: HitlRunState) => {
      updateHitlState(state)
      await opts.onEvent({
        type: 'log',
        timestamp: new Date().toISOString(),
        message: 'hitl_request_denied',
        payload: { reason },
        runId
      })
    }

    await opts.onEvent({
      type: 'start',
      timestamp: new Date().toISOString(),
      payload: {
        runId,
        threadId,
        correlationId: opts.correlationId
      }
    })

    const isResume = Boolean(existing && existing.run.status === 'awaiting_hitl')

    if (isResume && existing) {
      updateHitlState(hitlState)
      await this.persistence.updateStatus(runId, 'running')

      const plan = this.rehydratePlan(existing, envelopeToUse)
      await opts.onEvent({
        type: 'plan_generated',
        timestamp: new Date().toISOString(),
        payload: {
          plan: {
            runId: plan.runId,
            version: plan.version,
            nodes: plan.nodes.map((node) => ({
              id: node.id,
              capabilityId: node.capabilityId,
              label: node.label
            })),
            metadata: { resumed: true }
          }
        }
      })

      const finalOutput = existing.run.result ?? this.extractFinalOutput(existing.nodes)
      if (!finalOutput) {
        throw new Error('No stored output available for flex HITL resume')
      }

      await this.engine.resumePending(runId, envelopeToUse, plan, finalOutput, {
        onEvent: opts.onEvent,
        hitl: {
          service: this.hitlService,
          state: hitlState,
          threadId,
          limit: hitlLimit,
          updateState: updateHitlState
        }
      })
      return { runId, status: 'completed', output: finalOutput }
    }

    let planSnapshot: FlexPlanNodeSnapshot[] = []
    try {
      const plan = await this.planner.buildPlan(runId, envelopeToUse)
      planSnapshot = plan.nodes.map((node) => ({
        nodeId: node.id,
        capabilityId: node.capabilityId,
        label: node.label,
        status: 'pending',
        context: node.bundle
      }))
      await this.persistence.savePlanSnapshot(runId, plan.version, planSnapshot)
      await opts.onEvent({
        type: 'plan_generated',
        timestamp: new Date().toISOString(),
        payload: {
          plan: {
            runId: plan.runId,
            version: plan.version,
            nodes: plan.nodes.map((node) => ({
              id: node.id,
              capabilityId: node.capabilityId,
              label: node.label
            })),
            metadata: plan.metadata
          }
        }
      })

      await this.persistence.updateStatus(runId, 'running')
      const finalOutput = await this.engine.execute(runId, envelopeToUse, plan, {
        onEvent: opts.onEvent,
        hitl: {
          service: this.hitlService,
          state: hitlState,
          threadId,
          limit: hitlLimit,
          onRequest: signalHitlRequest,
          onDenied: signalHitlDenied,
          updateState: updateHitlState
        }
      })
      await this.persistence.recordResult(runId, finalOutput)
      await this.persistence.updateStatus(runId, 'completed')
      return { runId, status: 'completed', output: finalOutput }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (error instanceof HitlPauseError) {
        await this.persistence.updateStatus(runId, 'awaiting_hitl')
        return { runId, status: 'awaiting_hitl', output: null }
      }
      const status: 'failed' | 'cancelled' = error.name === 'AbortError' ? 'cancelled' : 'failed'
      await this.persistence.updateStatus(runId, status)

      await opts.onEvent({
        type: 'log',
        timestamp: new Date().toISOString(),
        message: error.message,
        payload: { runId }
      })
      throw err
    }
  }

  private rehydratePlan(existing: { run: FlexRunRecord; nodes: FlexPlanNodeSnapshot[] }, envelope: TaskEnvelope): FlexPlan {
    return {
      runId: existing.run.runId,
      version: existing.run.planVersion ?? 1,
      createdAt: new Date().toISOString(),
      nodes: existing.nodes.map((node) => ({
        id: node.nodeId,
        capabilityId: node.capabilityId ?? 'unknown',
        label: node.label ?? node.nodeId,
        bundle: this.normalizeContextBundle(existing.run.runId, node, envelope)
      })),
      edges: [],
      metadata: { resumed: true }
    }
  }

  private extractFinalOutput(nodes: FlexPlanNodeSnapshot[]) {
    const terminal = nodes[nodes.length - 1]
    return terminal?.output ?? null
  }

  private normalizeContextBundle(runId: string, node: FlexPlanNodeSnapshot, envelope: TaskEnvelope): ContextBundle {
    if (node.context) return node.context as ContextBundle
    const fallbackContract: NodeContract = {
      output: envelope.outputContract as OutputContract
    }
    return {
      runId,
      nodeId: node.nodeId,
      objective: envelope.objective,
      contract: fallbackContract
    }
  }
}
