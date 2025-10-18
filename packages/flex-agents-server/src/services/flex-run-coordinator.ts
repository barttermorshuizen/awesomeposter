import { createHash } from 'node:crypto'
import type { TaskEnvelope, FlexEvent, HitlRunState, HitlRequestRecord, OutputContract, ContextBundle, NodeContract } from '@awesomeposter/shared'
import { genCorrelationId, getLogger } from './logger'
import { FlexRunPersistence, type FlexPlanNodeSnapshot, type FlexRunRecord } from './orchestrator-persistence'
import { FlexPlanner, PlannerDraftRejectedError, type FlexPlan, type PlannerGraphState } from './flex-planner'
import { FlexExecutionEngine, HitlPauseError, ReplanRequestedError } from './flex-execution-engine'
import { getHitlService, type HitlService } from './hitl-service'
import { PolicyNormalizer, type NormalizedPolicies } from './policy-normalizer'
import { RunContext, type FacetSnapshot } from './run-context'

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
    private readonly hitlService: HitlService = getHitlService(),
    private readonly policyNormalizer = new PolicyNormalizer()
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

    const loadedByRunId = providedRunId ? await this.persistence.loadFlexRun(providedRunId) : null
    const loadedByThreadId = providedThreadId ? await this.persistence.findFlexRunByThreadId(providedThreadId) : null

    const isAwaitingHitl = (snapshot: typeof loadedByRunId | typeof loadedByThreadId | null): snapshot is NonNullable<typeof snapshot> =>
      Boolean(snapshot && snapshot.run.status === 'awaiting_hitl')

    const resumeCandidate =
      (isAwaitingHitl(loadedByRunId) ? loadedByRunId : null) ??
      (isAwaitingHitl(loadedByThreadId) ? loadedByThreadId : null)

    const runId = resumeCandidate?.run.runId ?? `flex_${genCorrelationId()}`
    const threadId = providedThreadId ?? resumeCandidate?.run.threadId ?? null
    const envelopeToUse = resumeCandidate ? resumeCandidate.run.envelope : envelope
    const normalizedPolicies: NormalizedPolicies = this.policyNormalizer.normalize(envelopeToUse)
    const runContext = resumeCandidate?.run.contextSnapshot
      ? RunContext.fromSnapshot(resumeCandidate.run.contextSnapshot)
      : new RunContext()
    const schemaHashValue = schemaHash(envelopeToUse.outputContract)

    if (!resumeCandidate) {
      await this.persistence.createOrUpdateRun({
        runId,
        envelope: envelopeToUse,
        status: 'pending',
        threadId,
        objective: envelopeToUse.objective,
        schemaHash: schemaHashValue,
        metadata: (envelopeToUse.metadata ?? {}) as Record<string, unknown> | null,
        contextSnapshot: runContext.snapshot()
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

    const isResume = Boolean(resumeCandidate)
    let plannerAttemptCounter = 0
    const requestPlan = async (
      phase: 'initial' | 'replan',
      requestOptions: { graphState?: PlannerGraphState } = {}
    ): Promise<{ plan: FlexPlan; attempt: number }> => {
      const maxPlannerAttempts = 2
      let attemptsInPhase = 0
      while (attemptsInPhase < maxPlannerAttempts) {
        attemptsInPhase += 1
        plannerAttemptCounter += 1
        const attemptNumber = plannerAttemptCounter
        try {
          const plan = await this.planner.buildPlan(runId, envelopeToUse, {
            normalizedPolicies: normalizedPolicies.raw,
            graphState: requestOptions.graphState,
            onRequest: async (context) => {
              await opts.onEvent({
                type: 'plan_requested',
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                  runId,
                  attempt: attemptNumber,
                  phase,
                  scenario: context.scenario,
                  variantCount: context.variantCount,
                  policies: context.policies,
                  normalizedPolicies: {
                    keys: Object.keys(normalizedPolicies.raw),
                    replanDirectives: normalizedPolicies.replanDirectives
                  },
                  capabilities: context.capabilities.map((capability) => ({
                    capabilityId: capability.capabilityId,
                    displayName: capability.displayName,
                    status: capability.status
                  }))
                }
              })
            }
          })
          plan.metadata = {
            ...plan.metadata,
            plannerAttempts: attemptNumber,
            plannerPhase: phase
          }
          return { plan, attempt: attemptNumber }
        } catch (error) {
          if (error instanceof PlannerDraftRejectedError) {
            await opts.onEvent({
              type: 'plan_rejected',
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                runId,
                attempt: attemptNumber,
                phase,
                diagnostics: error.diagnostics
              }
            })
            if (attemptsInPhase >= maxPlannerAttempts) {
              throw error
            }
            continue
          }
          throw error
        }
      }
      throw new Error('Planner failed to produce a valid plan')
    }

    if (isResume && resumeCandidate) {
      updateHitlState(hitlState)
      await this.persistence.updateStatus(runId, 'running')

      const plan = this.rehydratePlan(resumeCandidate, envelopeToUse)
      await opts.onEvent({
        type: 'plan_generated',
        timestamp: new Date().toISOString(),
        payload: {
          plan: {
            runId: plan.runId,
            version: plan.version,
            nodes: plan.nodes.map((node) => {
              const contractSource = node.contracts
              const contracts =
                contractSource && (contractSource.input || contractSource.output)
                  ? {
                      ...(contractSource.input ? { inputMode: contractSource.input.mode } : {}),
                      ...(contractSource.output ? { outputMode: contractSource.output.mode } : {})
                    }
                  : undefined
              const facetSource = node.facets
              const facets =
                (facetSource?.input?.length ?? 0) || (facetSource?.output?.length ?? 0)
                  ? { input: facetSource?.input ?? [], output: facetSource?.output ?? [] }
                  : undefined
              return {
                id: node.id,
                capabilityId: node.capabilityId,
                label: node.label,
                ...(contracts ? { contracts } : {}),
                ...(facets ? { facets } : {})
              }
            }),
            metadata: { resumed: true }
          }
        }
      })

      const contextProjection = runContext.composeFinalOutput(envelopeToUse.outputContract, plan)
      const persistedOutput = resumeCandidate.run.result ?? this.extractFinalOutput(resumeCandidate.nodes) ?? {}
      if (!Object.keys(contextProjection).length && Object.keys(persistedOutput).length) {
        for (const [facet, value] of Object.entries(persistedOutput)) {
          runContext.updateFacet(facet, value, {
            nodeId: plan.nodes[plan.nodes.length - 1]?.id ?? 'resume_final',
            capabilityId: plan.nodes[plan.nodes.length - 1]?.capabilityId,
            rationale: 'resume_persisted_output'
          })
        }
      }
      const finalOutputCandidate =
        Object.keys(contextProjection).length ? contextProjection : persistedOutput
      if (!finalOutputCandidate || Object.keys(finalOutputCandidate).length === 0) {
        throw new Error('No stored output available for flex HITL resume')
      }

      const finalOutput = await this.engine.resumePending(runId, envelopeToUse, plan, finalOutputCandidate, {
        onEvent: opts.onEvent,
        correlationId: opts.correlationId,
        hitl: {
          service: this.hitlService,
          state: hitlState,
          threadId,
          limit: hitlLimit,
          updateState: updateHitlState
        }
      })
      await this.persistence.saveRunContext(runId, runContext.snapshot())
      return { runId, status: 'completed', output: finalOutput }
    }

    let planSnapshot: FlexPlanNodeSnapshot[] = []
    try {
      const { plan: initialPlan } = await requestPlan('initial')
      let activePlan: FlexPlan = initialPlan

      planSnapshot = activePlan.nodes.map((node) => ({
        nodeId: node.id,
        capabilityId: node.capabilityId,
        label: node.label,
        status: 'pending',
        context: node.bundle
      }))
      await this.persistence.savePlanSnapshot(runId, activePlan.version, planSnapshot, {
        facets: runContext.snapshot()
      })
      await opts.onEvent({
        type: 'plan_generated',
        timestamp: new Date().toISOString(),
        payload: {
          plan: {
            runId: activePlan.runId,
            version: activePlan.version,
            nodes: activePlan.nodes.map((node) => {
              const contractSource = node.contracts
              const contracts =
                contractSource && (contractSource.input || contractSource.output)
                  ? {
                      ...(contractSource.input ? { inputMode: contractSource.input.mode } : {}),
                      ...(contractSource.output ? { outputMode: contractSource.output.mode } : {})
                    }
                  : undefined
              const facetSource = node.facets
              const facets =
                (facetSource?.input?.length ?? 0) || (facetSource?.output?.length ?? 0)
                  ? { input: facetSource?.input ?? [], output: facetSource?.output ?? [] }
                  : undefined
              return {
                id: node.id,
                capabilityId: node.capabilityId,
                label: node.label,
                ...(contracts ? { contracts } : {}),
                ...(facets ? { facets } : {})
              }
            }),
            metadata: activePlan.metadata
          }
        }
      })

      await this.persistence.updateStatus(runId, 'running')
      let finalOutput: Record<string, unknown> | null = null
      let pendingState: {
        completedNodeIds: string[]
        nodeOutputs: Record<string, Record<string, unknown>>
        facets: FacetSnapshot
      } | undefined

      while (!finalOutput) {
        try {
          const result = await this.engine.execute(runId, envelopeToUse, activePlan, {
            onEvent: opts.onEvent,
            correlationId: opts.correlationId,
            hitl: {
              service: this.hitlService,
              state: hitlState,
              threadId,
              limit: hitlLimit,
              onRequest: signalHitlRequest,
              onDenied: signalHitlDenied,
              updateState: updateHitlState
            },
            onNodeComplete: ({ node }) => this.policyNormalizer.shouldTriggerReplan(normalizedPolicies, node),
            initialState: pendingState,
            runContext
          })
          finalOutput = result
        } catch (error) {
          if (error instanceof ReplanRequestedError) {
            const trigger = error.trigger
            pendingState = {
              completedNodeIds: error.state.completedNodeIds,
              nodeOutputs: error.state.nodeOutputs,
              facets: error.state.facets
            }
            await opts.onEvent({
              type: 'policy_triggered',
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                runId,
                trigger
              }
            })

            const previousVersion = activePlan.version
            const graphState: PlannerGraphState = {
              plan: activePlan,
              completedNodeIds: pendingState!.completedNodeIds,
              nodeOutputs: pendingState!.nodeOutputs,
              facets: pendingState!.facets
            }
            const { plan: updatedPlan } = await requestPlan('replan', { graphState })
            if (updatedPlan.version <= previousVersion) {
              updatedPlan.version = previousVersion + 1
              updatedPlan.metadata = {
                ...updatedPlan.metadata,
                versionAdjusted: true
              }
            }
            activePlan = updatedPlan

            planSnapshot = activePlan.nodes.map((node) => ({
              nodeId: node.id,
              capabilityId: node.capabilityId,
              label: node.label,
              status: pendingState!.completedNodeIds.includes(node.id) ? 'completed' : 'pending',
              context: node.bundle,
              output: pendingState!.nodeOutputs[node.id] ?? null
            }))
            pendingState!.completedNodeIds = pendingState!.completedNodeIds.filter((nodeId) =>
              activePlan.nodes.some((node) => node.id === nodeId)
            )
            pendingState!.nodeOutputs = Object.fromEntries(
              Object.entries(pendingState!.nodeOutputs).filter(([nodeId]) =>
                activePlan.nodes.some((node) => node.id === nodeId)
              )
            ) as Record<string, Record<string, unknown>>
            pendingState!.facets = runContext.snapshot()
            await this.persistence.savePlanSnapshot(runId, activePlan.version, planSnapshot, {
              facets: pendingState!.facets
            })
            await opts.onEvent({
              type: 'plan_updated',
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                runId,
                previousVersion,
                version: activePlan.version,
                trigger,
                nodes: activePlan.nodes.map((node) => ({
                  id: node.id,
                  capabilityId: node.capabilityId,
                  label: node.label,
                  status: pendingState!.completedNodeIds.includes(node.id) ? 'completed' : 'pending'
                })),
                metadata: activePlan.metadata
              }
            })
            continue
          }
          throw error
        }
      }

      await this.persistence.saveRunContext(runId, runContext.snapshot())
      await this.persistence.recordResult(runId, finalOutput)
      await this.persistence.updateStatus(runId, 'completed')
      return { runId, status: 'completed', output: finalOutput }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err))
      if (error instanceof HitlPauseError) {
        await this.persistence.saveRunContext(runId, runContext.snapshot())
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
