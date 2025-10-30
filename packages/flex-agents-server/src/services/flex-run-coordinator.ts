import { createHash } from 'node:crypto'
import type {
  TaskEnvelope,
  FlexEvent,
  HitlRunState,
  HitlRequestRecord,
  OutputContract,
  ContextBundle,
  NodeContract,
  FlexFacetProvenanceMap,
  HitlContractSummary
} from '@awesomeposter/shared'
import { genCorrelationId, getLogger } from './logger'
import {
  FlexRunPersistence,
  type FlexPlanNodeSnapshot,
  type FlexPlanSnapshotRow,
  type FlexRunRecord
} from './orchestrator-persistence'
import {
  FlexPlanner,
  PlannerDraftRejectedError,
  type FlexPlan,
  type FlexPlanNodeContracts,
  type FlexPlanNodeFacets,
  type FlexPlanNodeProvenance,
  type FlexPlanNodeKind,
  type FlexPlanEdge,
  type PlannerGraphState
} from './flex-planner'
import {
  FlexExecutionEngine,
  HitlPauseError,
  AwaitingHumanInputError,
  ReplanRequestedError,
  RunPausedError,
  RuntimePolicyFailureError,
  FlexValidationError
} from './flex-execution-engine'
import { getHitlService, parseHitlDecisionAction, resolveHitlDecision, type HitlService } from './hitl-service'
import { PolicyNormalizer, type NormalizedPolicies } from './policy-normalizer'
import { RunContext, type RunContextSnapshot } from './run-context'
import type { PendingPolicyActionState, RuntimePolicySnapshotMode } from './runtime-policy-types'
import { getTelemetryService } from './telemetry-service'

type RunOptions = {
  onEvent: (event: FlexEvent) => Promise<void>
  correlationId?: string
  resumeSubmission?: {
    nodeId: string
    output?: Record<string, unknown>
    decline?: {
      reason: string
      note?: string | null
    }
    submittedAt?: string
    note?: string | null
  }
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
  status: 'completed' | 'awaiting_hitl' | 'awaiting_human' | 'failed'
  output: Record<string, unknown> | null
}

const isRuntimePolicyFailureError = (error: unknown): error is RuntimePolicyFailureError => {
  if (error instanceof RuntimePolicyFailureError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; policyId?: unknown; message?: unknown }
  return (
    typeof candidate.policyId === 'string' &&
    typeof candidate.message === 'string' &&
    (candidate.name === 'RuntimePolicyFailureError' || candidate.name === 'RuntimePolicyError')
  )
}

const isFlexValidationError = (error: unknown): error is FlexValidationError => {
  if (error instanceof FlexValidationError) return true
  if (!error || typeof error !== 'object') return false
  const candidate = error as { name?: unknown; scope?: unknown; errors?: unknown }
  return (
    (candidate.name === 'FlexValidationError' || candidate.name === 'ValidationError') &&
    typeof candidate.scope === 'string' &&
    Array.isArray(candidate.errors)
  )
}

const formatFacetTitle = (value: string, fallback: string): string => {
  if (!value) return fallback
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_\-]+/g, ' ')
    .trim()
  if (!words) return fallback
  return words.charAt(0).toUpperCase() + words.slice(1)
}

type FacetProvenanceEntry = {
  facet: string
  title: string
  direction: 'input' | 'output'
  pointer: string
}

const normalizeFacetPointer = (pointer: string, facet: string): string => {
  if (!pointer) {
    return `#/${facet}`
  }
  if (pointer.startsWith('#')) {
    return pointer
  }
  const trimmed = pointer.replace(/^\/+/, '')
  if (!trimmed) {
    return `#/${facet}`
  }
  return `#/${trimmed}`
}

export class FlexRunCoordinator {
  constructor(
    private readonly persistence = new FlexRunPersistence(),
    private readonly planner = new FlexPlanner(),
    private readonly engine = new FlexExecutionEngine(),
    private readonly hitlService: HitlService = getHitlService(),
    private readonly policyNormalizer = new PolicyNormalizer(),
    private readonly emittedHitlResolutions = new Map<string, Set<string>>()
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

    const isAwaitingPause = (snapshot: typeof loadedByRunId | typeof loadedByThreadId | null): snapshot is NonNullable<typeof snapshot> =>
      Boolean(snapshot && (snapshot.run.status === 'awaiting_hitl' || snapshot.run.status === 'awaiting_human'))

    const resumeCandidate =
      (isAwaitingPause(loadedByRunId) ? loadedByRunId : null) ??
      (isAwaitingPause(loadedByThreadId) ? loadedByThreadId : null)

    const runId = resumeCandidate?.run.runId ?? `flex_${genCorrelationId()}`
    const threadId = providedThreadId ?? resumeCandidate?.run.threadId ?? null
    const envelopeToUse = resumeCandidate ? resumeCandidate.run.envelope : envelope
    const normalizedPolicies: NormalizedPolicies = this.policyNormalizer.normalize(envelopeToUse)
    const telemetry = getTelemetryService()
    const runContext = resumeCandidate?.run.contextSnapshot
      ? RunContext.fromSnapshot(resumeCandidate.run.contextSnapshot)
      : new RunContext()
    const schemaHashValue = schemaHash(envelopeToUse.outputContract)
    const executionEnvelope: TaskEnvelope = {
      ...envelopeToUse,
      policies: normalizedPolicies.canonical
    }
    const processedHitlDecisions = new Set<string>()
    let resolvedDecisionResult: RunResult | null = null
    let activePlan: FlexPlan | undefined
    let activePlanVersion: number | null = resumeCandidate?.run.planVersion ?? null
    const emitEvent = async (event: FlexEvent) => {
      const enriched: FlexEvent = {
        ...event,
        planVersion:
          typeof event.planVersion === 'number'
            ? event.planVersion
            : typeof activePlanVersion === 'number'
            ? activePlanVersion
            : event.planVersion
      }
      await opts.onEvent(enriched)
    }
    let pendingStartupEffect = resumeCandidate
      ? null
      : this.policyNormalizer.evaluateRunStartEffect(normalizedPolicies)
    const consumeStartupEffect = () => {
      if (!pendingStartupEffect) {
        return null
      }
      const effect = pendingStartupEffect
      pendingStartupEffect = null
      return effect
    }
    if (!this.emittedHitlResolutions.has(runId)) {
      this.emittedHitlResolutions.set(runId, new Set<string>())
    }

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
    const toEpoch = (value: unknown) => {
      if (value instanceof Date) return value.getTime()
      if (typeof value === 'number') return value
      if (typeof value === 'string') {
        const parsed = Date.parse(value)
        return Number.isNaN(parsed) ? 0 : parsed
      }
      return 0
    }
    const registerOutcome = async (
      status: 'failed' | 'completed',
      payload: {
        error?: string | null
        action?: { type: 'emit'; event: string; payload: unknown | null }
        nodeId?: string | null
      }
    ) => {
      const planVersion = activePlanVersion ?? undefined
      telemetry.recordRunStatus(status, {
        runId,
        correlationId: opts.correlationId ?? null,
        planVersion
      })

      if (status === 'failed') {
        telemetry.recordHitlRejection({
          runId,
          action: 'fail',
          nodeId: payload.nodeId ?? null,
          correlationId: opts.correlationId ?? null,
          planVersion,
          reason: payload.error ?? null
        })
        await this.persistence.updateStatus(runId, 'failed')
        await emitEvent({
          type: 'complete',
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            status: 'failed',
            error: payload.error ?? null
          }
        })
        resolvedDecisionResult = { runId, status: 'failed', output: null }
      } else {
        telemetry.recordHitlRejection({
          runId,
          action: 'emit',
          nodeId: payload.nodeId ?? null,
          correlationId: opts.correlationId ?? null,
          planVersion
        })
        await this.persistence.updateStatus(runId, 'completed')
        await emitEvent({
          type: 'complete',
          timestamp: new Date().toISOString(),
          runId,
          payload: {
            status: 'policy_action',
            action: payload.action ?? null
          }
        })
        resolvedDecisionResult = { runId, status: 'completed', output: null }
      }
    }
    const checkResolvedHitlOutcome = async () => {
      if (resolvedDecisionResult) return
      const resolved = hitlState.requests.filter((req) => req.status === 'resolved')
      if (!resolved.length) return
      resolved.sort((a, b) => toEpoch(b.updatedAt ?? b.createdAt) - toEpoch(a.updatedAt ?? a.createdAt))
      for (const request of resolved) {
        if (processedHitlDecisions.has(request.id)) continue
        processedHitlDecisions.add(request.id)
        const decision = resolveHitlDecision(hitlState, request.id)
        if (!decision || decision.kind !== 'reject') continue
        const action = parseHitlDecisionAction(decision.response)
        const freeform = typeof decision.response.freeformText === 'string' ? decision.response.freeformText.trim() : ''
        const defaultReason = freeform || `Run rejected by operator (${decision.request.originAgent})`
        if (!action || action.type === 'fail') {
          const reason = (action?.message || defaultReason).trim() || defaultReason
          try {
            getLogger().warn('hitl_rejection_default_fail', {
              runId,
              requestId: decision.request.id,
              originAgent: decision.request.originAgent
            })
          } catch {}
          await emitEvent({
            type: 'log',
            timestamp: new Date().toISOString(),
            message: 'hitl_rejected',
            payload: {
              runId,
              requestId: decision.request.id,
              originAgent: decision.request.originAgent,
              reason
            }
          })
          await registerOutcome('failed', { error: reason, nodeId: decision.request.stepId ?? null })
          return
        }
        if (action.type === 'emit') {
          const eventName = action.event && action.event.trim().length > 0 ? action.event : 'hitl_rejected'
          await emitEvent({
            type: 'log',
            timestamp: new Date().toISOString(),
            message: eventName,
            payload: {
              runId,
              requestId: decision.request.id,
              originAgent: decision.request.originAgent,
              action: 'emit',
              payload: action.payload ?? null
            }
          })
          await registerOutcome('completed', {
            action: { type: 'emit', event: eventName, payload: action.payload ?? null },
            nodeId: decision.request.stepId ?? null
          })
          return
        }
      }
    }
    const hitlLimit = {
      current: hitlState.requests.filter((r) => r.status !== 'denied').length,
      max: this.hitlService.getMaxRequestsPerRun()
    }
    let hitlAwaiting: HitlRequestRecord | null = hitlState.pendingRequestId
      ? hitlState.requests.find((req) => req.id === hitlState.pendingRequestId) || null
      : null
    const signalHitlResolved = async (record: HitlRequestRecord, state: HitlRunState) => {
      if (record.status !== 'resolved') return
      const resolvedSet = this.emittedHitlResolutions.get(runId) ?? new Set<string>()
      if (resolvedSet.has(record.id)) return
      resolvedSet.add(record.id)
      this.emittedHitlResolutions.set(runId, resolvedSet)
      const responses = state.responses.filter((resp) => resp.requestId === record.id)
      const planNode = resolvePlanNodeForRecord(record)
      const facetProvenance = computeFacetProvenance(record, planNode)
      const contractSummary = buildContractSummary(record, planNode, facetProvenance ?? undefined)
      if (process.env.DEBUG_FLEX_HITL === '1') {
        // eslint-disable-next-line no-console
        console.log('debug:flex.hitl_resolved.facets', {
          facets: facetProvenance,
          stepId: record.stepId,
          resolvedNodeId: planNode?.id
        })
      }
      await emitEvent({
        type: 'hitl_resolved',
        timestamp: new Date().toISOString(),
        runId,
        nodeId: record.stepId ?? undefined,
        facetProvenance,
        payload: {
          request: {
            id: record.id,
            originAgent: record.originAgent,
            status: record.status,
            resolvedAt: record.updatedAt.toISOString(),
            responses,
            contractSummary: contractSummary ?? null
          }
        }
      })
      await checkResolvedHitlOutcome()
    }
    const updateHitlState = async (state: HitlRunState) => {
      if (hitlAwaiting && state.pendingRequestId !== hitlAwaiting.id) {
        const record = state.requests.find((req) => req.id === hitlAwaiting!.id)
        if (record && record.status !== 'pending') {
          await signalHitlResolved(record, state)
        }
        hitlAwaiting = null
      }
      hitlState = state
      hitlLimit.current = state.requests.filter((r) => r.status !== 'denied').length
      hitlAwaiting = state.pendingRequestId ? state.requests.find((req) => req.id === state.pendingRequestId) || null : null

      for (const request of state.requests) {
        if (request.payload.kind !== 'clarify') continue
        const responses = state.responses.filter((res) => res.requestId === request.id)
        if (!responses.length) continue
        const latest = responses[responses.length - 1]
        let answer: string | null = null
        if (typeof latest.freeformText === 'string' && latest.freeformText.trim().length) {
          answer = latest.freeformText.trim()
        } else if (typeof latest.selectedOptionId === 'string' && latest.selectedOptionId.trim().length) {
          answer = latest.selectedOptionId.trim()
        } else if (typeof latest.approved === 'boolean') {
          answer = latest.approved ? 'approved' : 'rejected'
        }
        if (answer) {
          const answeredAt = latest.createdAt instanceof Date
            ? latest.createdAt.toISOString()
            : new Date(latest.createdAt).toISOString()
          runContext.recordClarificationAnswer({ questionId: request.id, answer, answeredAt })
        }
      }

      const resolvedSet = this.emittedHitlResolutions.get(runId) ?? new Set<string>()
      for (const request of state.requests) {
        if (request.status === 'resolved' && !resolvedSet.has(request.id)) {
          await signalHitlResolved(request, state)
        }
      }
      this.emittedHitlResolutions.set(runId, resolvedSet)
      await checkResolvedHitlOutcome()
    }
    const findPlanNodeByHint = (hint?: string | null): FlexPlan['nodes'][number] | undefined => {
      if (!activePlan || !hint) return undefined
      const direct = activePlan.nodes.find((node) => node.id === hint)
      if (direct) return direct
      const normalized = hint.replace(/\./g, '_')
      const byNormalized = activePlan.nodes.find((node) => node.id === normalized)
      if (byNormalized) return byNormalized
      const capabilityHint = hint.split('_')[0]
      if (capabilityHint) {
        const capabilityId = capabilityHint.replace(/_/g, '.')
        const byCapability = activePlan.nodes.find((node) => node.capabilityId === capabilityId)
        if (byCapability) return byCapability
      }
      return undefined
    }

    const resolvePlanNodeForRecord = (record: HitlRequestRecord): FlexPlan['nodes'][number] | undefined => {
      const hints = [record.pendingNodeId ?? null, record.stepId ?? null, record.contractSummary?.nodeId ?? null]
      for (const hint of hints) {
        const node = findPlanNodeByHint(hint)
        if (node) return node
      }
      return undefined
    }

    const buildFacetEntries = (facets: string[] | undefined, direction: 'input' | 'output'): FacetProvenanceEntry[] => {
      if (!facets?.length) return []
      return facets.map((facet) => ({
        facet,
        title: formatFacetTitle(facet, direction === 'input' ? 'Input Facet' : 'Output Facet'),
        direction,
        pointer: `#/${facet}`
      }))
    }

    const mergeFacetEntries = (
      direction: 'input' | 'output',
      sources: Array<FacetProvenanceEntry[] | undefined>
    ): FacetProvenanceEntry[] => {
      const seen = new Set<string>()
      const merged: FacetProvenanceEntry[] = []
      for (const source of sources) {
        for (const entry of source ?? []) {
          if (!entry || typeof entry !== 'object') continue
          const facet = typeof entry.facet === 'string' && entry.facet.length ? entry.facet : null
          if (!facet) continue
          const pointer = normalizeFacetPointer(typeof entry.pointer === 'string' ? entry.pointer : '', facet)
          const title =
            typeof entry.title === 'string' && entry.title.trim().length
              ? entry.title
              : formatFacetTitle(facet, direction === 'input' ? 'Input Facet' : 'Output Facet')
          const key = `${direction}:${facet}:${pointer}`
          if (seen.has(key)) continue
          seen.add(key)
          merged.push({
            facet,
            title,
            direction,
            pointer
          })
        }
      }
      return merged
    }

    const computeFacetProvenance = (
      record: HitlRequestRecord,
      planNode: FlexPlan['nodes'][number] | undefined
    ): FlexFacetProvenanceMap | undefined => {
      const contractFacets = (record.contractSummary?.facets as FlexFacetProvenanceMap | undefined) ?? undefined
      const planProvenance = planNode?.provenance as FlexFacetProvenanceMap | undefined
      const planFacets = planNode?.facets
      const input = mergeFacetEntries('input', [
        contractFacets?.input as FacetProvenanceEntry[] | undefined,
        planProvenance?.input as FacetProvenanceEntry[] | undefined,
        buildFacetEntries(planFacets?.input, 'input')
      ])
      const output = mergeFacetEntries('output', [
        contractFacets?.output as FacetProvenanceEntry[] | undefined,
        planProvenance?.output as FacetProvenanceEntry[] | undefined,
        buildFacetEntries(planFacets?.output, 'output')
      ])
      if (!input.length && !output.length) {
        return undefined
      }
      const combined: FlexFacetProvenanceMap = {}
      if (input.length) combined.input = input
      if (output.length) combined.output = output
      return combined
    }

    const cloneValue = <T>(value: T): T => {
      if (value == null) return value
      try {
        return JSON.parse(JSON.stringify(value)) as T
      } catch {
        return value
      }
    }

    const buildContractSummary = (
      record: HitlRequestRecord,
      planNode: FlexPlan['nodes'][number] | undefined,
      facets: FlexFacetProvenanceMap | undefined
    ): HitlContractSummary | null => {
      if (record.contractSummary) return record.contractSummary
      if (!planNode) return null
      const outputContract =
        planNode.contracts?.output ?? (executionEnvelope.outputContract as OutputContract | undefined) ?? null
      if (!outputContract) return null
      const contract: HitlContractSummary['contract'] = {
        ...(planNode.contracts?.input ? { input: cloneValue(planNode.contracts.input) } : {}),
        output: cloneValue(outputContract)
      }
      return {
        nodeId: planNode.id,
        nodeLabel: planNode.label,
        capabilityId: planNode.capabilityId ?? undefined,
        capabilityLabel: planNode.capabilityLabel ?? planNode.label,
        planVersion: activePlan?.version ?? undefined,
        contract,
        facets: facets ?? undefined
      }
    }

    const signalHitlRequest = async (record: HitlRequestRecord, state: HitlRunState) => {
      await updateHitlState(state)
      const planNode = resolvePlanNodeForRecord(record)
      const facetProvenance = computeFacetProvenance(record, planNode)
      const contractSummary = buildContractSummary(record, planNode, facetProvenance ?? undefined)
      if (!record.pendingNodeId && planNode) {
        record.pendingNodeId = planNode.id
      }
      if (!record.contractSummary && contractSummary) {
        record.contractSummary = contractSummary
      }
      if (process.env.DEBUG_FLEX_HITL === '1') {
        // eslint-disable-next-line no-console
        console.log('debug:flex.hitl_request.facets', {
          facets: facetProvenance,
          stepId: record.stepId,
          pendingNodeId: record.pendingNodeId,
          resolvedNodeId: planNode?.id
        })
      }
      const operatorPrompt =
        typeof record.operatorPrompt === 'string' && record.operatorPrompt.trim().length
          ? record.operatorPrompt
          : (() => {
              if (!planNode) {
                return 'Review pending flex run output and approve before resuming execution.'
              }
              const summary: string[] = [
                `Review "${planNode.label}" (${planNode.capabilityLabel ?? planNode.capabilityId ?? planNode.id}).`
              ]
              const outputFacets = planNode.provenance?.output ?? []
              if (outputFacets.length) {
                summary.push(`Focus on facets: ${outputFacets.map((entry) => entry.title || entry.facet).join(', ')}.`)
              }
              return summary.join(' ')
            })()
      await emitEvent({
        type: 'hitl_request',
        timestamp: new Date().toISOString(),
        runId,
        nodeId: record.stepId ?? undefined,
        facetProvenance,
        payload: {
          request: {
            id: record.id,
            originAgent: record.originAgent,
            payload: record.payload,
            createdAt: record.createdAt,
            pendingNodeId: record.pendingNodeId ?? planNode?.id ?? null,
            operatorPrompt,
            contractSummary: contractSummary ?? null
          }
        }
      })
    }
    const signalHitlDenied = async (reason: string, state: HitlRunState) => {
      await updateHitlState(state)
      await emitEvent({
        type: 'log',
        timestamp: new Date().toISOString(),
        message: 'hitl_request_denied',
        payload: { reason },
        runId
      })
    }

    await checkResolvedHitlOutcome()
    if (resolvedDecisionResult) {
      return resolvedDecisionResult
    }
    await updateHitlState(hitlState)
    if (resolvedDecisionResult) {
      return resolvedDecisionResult
    }
    if (hitlAwaiting) {
      await signalHitlRequest(hitlAwaiting, hitlState)
      if (resolvedDecisionResult) {
        return resolvedDecisionResult
      }
    }

    await emitEvent({
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
            policies: normalizedPolicies.canonical,
            policyMetadata: {
              legacyNotes: normalizedPolicies.legacyNotes,
              legacyFields: normalizedPolicies.legacyFields
            },
            graphState: requestOptions.graphState,
            onRequest: async (requestContext) => {
              const plannerHints = requestContext.context
              await emitEvent({
                type: 'plan_requested',
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                  runId,
                  attempt: attemptNumber,
                  phase,
                  variantCount: requestContext.variantCount,
                  plannerContext: {
                    channel: plannerHints.channel ?? null,
                    platform: plannerHints.platform ?? null,
                    formats: plannerHints.formats,
                    languages: plannerHints.languages,
                    audiences: plannerHints.audiences,
                    tags: plannerHints.tags
                  },
                  policies: requestContext.policies,
                  policyMetadata: {
                    planner: {
                      hasTopology: Boolean(normalizedPolicies.planner?.topology),
                      hasSelection: Boolean(normalizedPolicies.planner?.selection),
                      optimisation: normalizedPolicies.planner?.optimisation?.objective ?? null
                    },
                    runtime: {
                      count: normalizedPolicies.runtime.length,
                      actions: normalizedPolicies.runtime.map((policy) => policy.action.type)
                    },
                    legacyNotes: normalizedPolicies.legacyNotes,
                    legacyFields: normalizedPolicies.legacyFields
                  },
                  capabilities: requestContext.capabilities.map((capability) => ({
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
            await emitEvent({
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
      await updateHitlState(hitlState)

      const latestSnapshot = await this.persistence.loadPlanSnapshot(
        runId,
        resumeCandidate.run.planVersion ?? undefined
      )
      if (!latestSnapshot) {
        throw new Error('No plan snapshot available for flex HITL resume')
      }
      if (
        typeof resumeCandidate.run.planVersion === 'number' &&
        latestSnapshot.planVersion !== resumeCandidate.run.planVersion
      ) {
        throw new Error('Stale plan snapshot detected for flex HITL resume')
      }

      activePlan = this.rehydratePlan(resumeCandidate, envelopeToUse, latestSnapshot)
      activePlanVersion = activePlan.version
      await emitEvent({
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
              const derived =
                node.derivedCapability?.fromCapabilityId &&
                typeof node.derivedCapability.fromCapabilityId === 'string'
                  ? { fromCapabilityId: node.derivedCapability.fromCapabilityId }
                  : undefined
              const metadata =
                node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : undefined
              return {
                id: node.id,
                capabilityId: node.capabilityId,
                label: node.label,
                kind: node.kind,
                status: 'pending',
                ...(contracts ? { contracts } : {}),
                ...(facets ? { facets } : {}),
                ...(derived ? { derivedCapability: derived } : {}),
                ...(metadata ? { metadata } : {})
              }
            }),
            metadata: { resumed: true }
          }
        }
      })

      const pendingStateSnapshotRaw =
        latestSnapshot.snapshot && typeof latestSnapshot.snapshot === 'object'
          ? (latestSnapshot.snapshot as { pendingState?: unknown }).pendingState ?? null
          : null
      let resumeInitialState = pendingStateSnapshotRaw
        ? {
            completedNodeIds: Array.isArray((pendingStateSnapshotRaw as any).completedNodeIds)
              ? ((pendingStateSnapshotRaw as any).completedNodeIds as string[])
              : [],
            nodeOutputs:
              (pendingStateSnapshotRaw as any).nodeOutputs &&
              typeof (pendingStateSnapshotRaw as any).nodeOutputs === 'object'
                ? ((pendingStateSnapshotRaw as any).nodeOutputs as Record<string, Record<string, unknown>>)
                : {},
            policyActions: Array.isArray((pendingStateSnapshotRaw as any).policyActions)
              ? ((pendingStateSnapshotRaw as any).policyActions as PendingPolicyActionState[])
              : [],
            policyAttempts:
              (pendingStateSnapshotRaw as any).policyAttempts &&
              typeof (pendingStateSnapshotRaw as any).policyAttempts === 'object'
                ? ((pendingStateSnapshotRaw as any).policyAttempts as Record<string, number>)
                : {},
            mode:
              typeof (pendingStateSnapshotRaw as any).mode === 'string'
                ? ((pendingStateSnapshotRaw as any).mode as RuntimePolicySnapshotMode)
                : undefined
          }
        : undefined

      let pendingState:
        | {
            completedNodeIds: string[]
            nodeOutputs: Record<string, Record<string, unknown>>
            facets: RunContextSnapshot
            policyActions?: PendingPolicyActionState[]
            policyAttempts?: Record<string, number>
            mode?: RuntimePolicySnapshotMode
          }
        | undefined = resumeInitialState
        ? {
            completedNodeIds: [...resumeInitialState.completedNodeIds],
            nodeOutputs: { ...resumeInitialState.nodeOutputs },
            facets: runContext.snapshot(),
            ...(resumeInitialState.policyActions
              ? { policyActions: [...resumeInitialState.policyActions] }
              : {}),
            ...(resumeInitialState.policyAttempts
              ? { policyAttempts: { ...resumeInitialState.policyAttempts } }
              : {}),
            mode: resumeInitialState.mode
          }
        : undefined

      const contextProjection = runContext.composeFinalOutput(envelopeToUse.outputContract, activePlan)
      const persistedOutput = resumeCandidate.run.result ?? this.extractFinalOutput(resumeCandidate.nodes) ?? {}
      if (!Object.keys(contextProjection).length && Object.keys(persistedOutput).length) {
        for (const [facet, value] of Object.entries(persistedOutput)) {
          runContext.updateFacet(facet, value, {
            nodeId: activePlan.nodes[activePlan.nodes.length - 1]?.id ?? 'resume_final',
            capabilityId: activePlan.nodes[activePlan.nodes.length - 1]?.capabilityId,
            rationale: 'resume_persisted_output'
          })
        }
      }

      let finalOutputSeed =
        Object.keys(contextProjection).length ? contextProjection : persistedOutput
      let executionMode: 'resume' | 'execute' = 'resume'
      if (!finalOutputSeed || Object.keys(finalOutputSeed).length === 0) {
        executionMode = 'execute'
        finalOutputSeed = {}
      }

      let resumeStatusUpdated = false

      if (resumeCandidate.run.status === 'awaiting_human') {
        const submission = opts.resumeSubmission
        if (!submission) {
          throw new Error('flex_resume_missing_submission_payload')
        }

        const humanNode = activePlan.nodes.find((node) => node.id === submission.nodeId)
        if (!humanNode) {
          throw new Error(`flex_resume_unknown_node:${submission.nodeId}`)
        }

        const validationOptions: FlexExecutionOptions = {
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
          runContext,
          schemaHash: schemaHashValue
        }

        if (submission.decline) {
          const declineTimestamp = new Date(submission.submittedAt ?? Date.now())
          const declineNote = submission.decline.note ?? submission.note ?? null
          const action =
            humanNode.bundle.assignment?.defaults?.onDecline ??
            humanNode.executor?.assignment?.defaults?.onDecline ??
            'fail_run'

          const contextBundle = (humanNode.context && typeof humanNode.context === 'object'
            ? JSON.parse(JSON.stringify(humanNode.context))
            : { runId, nodeId: humanNode.id }) as ContextBundle & Record<string, unknown>

          if (!contextBundle.assignment || typeof contextBundle.assignment !== 'object') {
            contextBundle.assignment = {}
          }
          contextBundle.assignment.status = 'completed'
          contextBundle.assignment.submittedAt = declineTimestamp.toISOString()
          contextBundle.assignment.updatedAt = declineTimestamp.toISOString()
          const assignmentMetadata =
            contextBundle.assignment.metadata && typeof contextBundle.assignment.metadata === 'object'
              ? { ...(contextBundle.assignment.metadata as Record<string, unknown>) }
              : {}
          assignmentMetadata.decline = {
            reason: submission.decline.reason,
            note: declineNote,
            action
          }
          contextBundle.assignment.metadata = assignmentMetadata

          await this.persistence.markNode(runId, humanNode.id, {
            status: 'completed',
            output: null,
            context: contextBundle as ContextBundle,
            error: {
              code: 'human_task_declined',
              message: submission.decline.reason,
              note: declineNote,
              action
            },
            completedAt: declineTimestamp
          })

          await emitEvent({
            type: 'node_complete',
            timestamp: declineTimestamp.toISOString(),
            runId,
            nodeId: humanNode.id,
            payload: {
              capabilityId: humanNode.capabilityId,
              label: humanNode.label,
              completedAt: declineTimestamp.toISOString(),
              executorType: 'human',
              outcome: 'declined',
              decline: {
                reason: submission.decline.reason,
                note: declineNote,
                action
              }
            }
          })

          await registerOutcome('failed', {
            error: submission.decline.reason,
            nodeId: humanNode.id ?? null
          })

          return { runId, status: 'failed', output: null }
        }

        const submissionOutput = submission.output
        if (!submissionOutput) {
          throw new Error('flex_resume_missing_submission_payload')
        }

        try {
          await this.engine.validateNodeOutput(humanNode, submissionOutput, runId, validationOptions)
        } catch (error) {
          const serialized =
            error && typeof error === 'object'
              ? {
                  message: (error as Error).message,
                  name: (error as Error).name,
                  ...(Object.prototype.hasOwnProperty.call(error, 'scope')
                    ? { scope: (error as any).scope }
                    : {}),
                  ...(Object.prototype.hasOwnProperty.call(error, 'errors')
                    ? { errors: (error as any).errors }
                    : {})
                }
              : { message: String(error) }

          await this.persistence.markNode(runId, humanNode.id, {
            status: 'awaiting_human',
            error: serialized,
            completedAt: null
          })
          await this.persistence.updateStatus(runId, 'awaiting_human')

          const errorTimestamp = new Date().toISOString()
          await emitEvent({
            type: 'node_error',
            timestamp: errorTimestamp,
            runId,
            nodeId: humanNode.id,
            payload: {
              capabilityId: humanNode.capabilityId,
              label: humanNode.label,
              executorType: 'human',
              error: serialized,
              submittedAt: submission.submittedAt ?? errorTimestamp
            }
          })
          return { runId, status: 'awaiting_human', output: null }
        }

        runContext.updateFromNode(humanNode, submissionOutput)
        if (!pendingState) {
          pendingState = {
            completedNodeIds: [],
            nodeOutputs: {},
            facets: runContext.snapshot(),
            mode: 'resume'
          }
        }

        pendingState.nodeOutputs = {
          ...pendingState.nodeOutputs,
          [humanNode.id]: submissionOutput
        }
        if (!pendingState.completedNodeIds.includes(humanNode.id)) {
          pendingState.completedNodeIds = [...pendingState.completedNodeIds, humanNode.id]
        }
        pendingState.facets = runContext.snapshot()
        pendingState.mode = 'resume'

        resumeInitialState = {
          completedNodeIds: [...pendingState.completedNodeIds],
          nodeOutputs: { ...pendingState.nodeOutputs },
          policyActions: pendingState.policyActions ? [...pendingState.policyActions] : [],
          policyAttempts: pendingState.policyAttempts ? { ...pendingState.policyAttempts } : {},
          mode: 'resume'
        }

        const completionInstant = new Date(submission.submittedAt ?? Date.now())
        const contextBundle = (humanNode.context && typeof humanNode.context === 'object'
          ? JSON.parse(JSON.stringify(humanNode.context))
          : (humanNode.bundle && typeof humanNode.bundle === 'object'
              ? JSON.parse(JSON.stringify(humanNode.bundle))
              : { runId, nodeId: humanNode.id })) as ContextBundle & Record<string, unknown>

        if (!contextBundle.runId) {
          contextBundle.runId = runId
        }
        contextBundle.nodeId = humanNode.id

        const assignmentContext =
          contextBundle.assignment && typeof contextBundle.assignment === 'object'
            ? (contextBundle.assignment as Record<string, unknown>)
            : ((contextBundle.assignment = {}) as Record<string, unknown>)

        assignmentContext.status = 'completed'
        assignmentContext.submittedAt = completionInstant.toISOString()
        assignmentContext.updatedAt = completionInstant.toISOString()
        if (!assignmentContext.assignmentId) {
          assignmentContext.assignmentId = `${runId}:${humanNode.id}`
        }
        if (!assignmentContext.runId) {
          assignmentContext.runId = runId
        }
        if (!assignmentContext.nodeId) {
          assignmentContext.nodeId = humanNode.id
        }

        const metadataContext =
          assignmentContext.metadata && typeof assignmentContext.metadata === 'object'
            ? (assignmentContext.metadata as Record<string, unknown>)
            : {}
        if (submission.note && submission.note.trim().length) {
          metadataContext.submissionNote = submission.note
        }
        assignmentContext.metadata = metadataContext

        const submissionOutputClone = JSON.parse(JSON.stringify(submissionOutput))
        contextBundle.currentOutput = submissionOutputClone
        contextBundle.output = submissionOutputClone
        contextBundle.priorOutputs = submissionOutputClone
        contextBundle.outputs = submissionOutputClone
        if (contextBundle.inputs && typeof contextBundle.inputs === 'object') {
          contextBundle.currentInputs = JSON.parse(JSON.stringify(contextBundle.inputs))
          contextBundle.input = JSON.parse(JSON.stringify(contextBundle.inputs))
          contextBundle.inputs = JSON.parse(JSON.stringify(contextBundle.inputs))
        }
        if (!contextBundle.facets || typeof contextBundle.facets !== 'object') {
          contextBundle.facets = {
            input: Array.isArray(humanNode.facets?.input) ? [...humanNode.facets.input] : [],
            output: Array.isArray(humanNode.facets?.output) ? [...humanNode.facets.output] : []
          }
        }
        if (!contextBundle.contracts || typeof contextBundle.contracts !== 'object') {
          contextBundle.contracts = {
            ...(humanNode.contracts?.input ? { input: JSON.parse(JSON.stringify(humanNode.contracts.input)) } : {}),
            ...(humanNode.contracts?.output
              ? { output: JSON.parse(JSON.stringify(humanNode.contracts.output)) }
              : {})
          }
        }
        if (!contextBundle.facetProvenance || typeof contextBundle.facetProvenance !== 'object') {
          contextBundle.facetProvenance = JSON.parse(
            JSON.stringify(humanNode.provenance ?? {})
          ) as Record<string, unknown>
        }
        contextBundle.runContextSnapshot = runContext.snapshot()

        await this.persistence.markNode(runId, humanNode.id, {
          status: 'completed',
          output: submissionOutput,
          context: contextBundle as ContextBundle,
          completedAt: completionInstant
        })
        await this.persistence.updateStatus(runId, 'running')
        resumeStatusUpdated = true
        await emitEvent({
          type: 'node_complete',
          timestamp: completionInstant.toISOString(),
          runId,
          nodeId: humanNode.id,
          payload: {
            capabilityId: humanNode.capabilityId,
            label: humanNode.label,
            completedAt: completionInstant.toISOString(),
            output: submissionOutput,
            executorType: 'human'
          }
        })

        executionMode = 'execute'
        finalOutputSeed = {}
      }

      if (!resumeStatusUpdated) {
        await this.persistence.updateStatus(runId, 'running')
        resumeStatusUpdated = true
      }

      let finalOutput: Record<string, unknown> | null = null

      while (!finalOutput) {
          if (resolvedDecisionResult) {
            return resolvedDecisionResult
          }
          try {
            if (executionMode === 'resume') {
              finalOutput = await this.engine.resumePending(runId, envelopeToUse, activePlan, finalOutputSeed, {
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
                schemaHash: schemaHashValue,
                runContext,
                initialState: resumeInitialState
                  ? {
                      completedNodeIds: resumeInitialState.completedNodeIds,
                      nodeOutputs: resumeInitialState.nodeOutputs,
                      policyActions: resumeInitialState.policyActions,
                      policyAttempts: resumeInitialState.policyAttempts,
                      mode: resumeInitialState.mode
                    }
                  : undefined
              })
            } else {
          const result = await this.engine.execute(runId, executionEnvelope, activePlan, {
            onEvent: emitEvent,
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
                onStart: pendingStartupEffect ? () => consumeStartupEffect() : undefined,
                onNodeComplete: ({ node }) => this.policyNormalizer.evaluateRuntimeEffect(normalizedPolicies, node),
                initialState: pendingState,
                runContext,
                schemaHash: schemaHashValue
              })
              finalOutput = result
            }
          } catch (error) {
            if (error instanceof ReplanRequestedError) {
              const trigger = error.trigger
              pendingState = {
                completedNodeIds: error.state.completedNodeIds,
                nodeOutputs: error.state.nodeOutputs,
                facets: error.state.facets,
                ...(error.state.policyActions ? { policyActions: error.state.policyActions } : {}),
                ...(error.state.policyAttempts ? { policyAttempts: error.state.policyAttempts } : {})
              }
              resumeInitialState = undefined
              await emitEvent({
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
              activePlanVersion = activePlan.version

              const snapshotNodes = activePlan.nodes.map((node) => ({
                nodeId: node.id,
                capabilityId: node.capabilityId,
                label: node.label,
                status: pendingState!.completedNodeIds.includes(node.id) ? 'completed' : 'pending',
                context: node.bundle,
                output: pendingState!.nodeOutputs[node.id] ?? null,
                facets: node.facets,
                contracts: node.contracts,
                provenance: node.provenance,
                metadata: node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : null,
                rationale: node.rationale && node.rationale.length ? [...node.rationale] : null
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
              await this.persistence.savePlanSnapshot(runId, activePlan.version, snapshotNodes, {
                facets: pendingState!.facets,
                schemaHash: schemaHashValue,
                edges: activePlan.edges,
                planMetadata: activePlan.metadata,
                pendingState: {
                  completedNodeIds: pendingState!.completedNodeIds,
                  nodeOutputs: pendingState!.nodeOutputs,
                  policyActions: pendingState!.policyActions ?? [],
                  policyAttempts: pendingState!.policyAttempts ?? {},
                  mode: pendingState!.mode
                }
              })
              await emitEvent({
                type: 'plan_updated',
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                  runId,
                  previousVersion,
                  version: activePlan.version,
                  trigger,
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
                    const derived =
                      node.derivedCapability?.fromCapabilityId &&
                      typeof node.derivedCapability.fromCapabilityId === 'string'
                        ? { fromCapabilityId: node.derivedCapability.fromCapabilityId }
                        : undefined
                    const metadata =
                      node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : undefined
                    return {
                      id: node.id,
                      capabilityId: node.capabilityId,
                      label: node.label,
                      kind: node.kind,
                      status: pendingState!.completedNodeIds.includes(node.id) ? 'completed' : 'pending',
                      ...(contracts ? { contracts } : {}),
                      ...(facets ? { facets } : {}),
                      ...(derived ? { derivedCapability: derived } : {}),
                      ...(metadata ? { metadata } : {})
                    }
                  }),
                  metadata: activePlan.metadata
                }
              })
              executionMode = 'execute'
              finalOutputSeed = null
              continue
            }

            if (error instanceof AwaitingHumanInputError) {
              await this.persistence.saveRunContext(runId, runContext.snapshot())
              await this.persistence.updateStatus(runId, 'awaiting_human')
              this.emittedHitlResolutions.delete(runId)
              return { runId, status: 'awaiting_human', output: null }
            }

            if (error instanceof HitlPauseError || error instanceof RunPausedError) {
              await this.persistence.saveRunContext(runId, runContext.snapshot())
              await this.persistence.updateStatus(runId, 'awaiting_hitl')
              this.emittedHitlResolutions.delete(runId)
              return { runId, status: 'awaiting_hitl', output: null }
            }

            if (isRuntimePolicyFailureError(error)) {
              await this.persistence.saveRunContext(runId, runContext.snapshot())
              await this.persistence.updateStatus(runId, 'failed')
              await emitEvent({
                type: 'complete',
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                  status: 'failed',
                  error: error.message,
                  policyId: error.policyId
                }
              })
              this.emittedHitlResolutions.delete(runId)
              return { runId, status: 'failed', output: null }
            }

            if (isFlexValidationError(error)) {
              await this.persistence.saveRunContext(runId, runContext.snapshot())
              await this.persistence.updateStatus(runId, 'failed')
              await emitEvent({
                type: 'complete',
                timestamp: new Date().toISOString(),
                runId,
                payload: {
                  status: 'failed',
                  error: error.message,
                  scope: error.scope
                }
              })
              this.emittedHitlResolutions.delete(runId)
              return { runId, status: 'failed', output: null }
            }

            if (process.env.DEBUG_FLEX_ERRORS === '1') {
              // eslint-disable-next-line no-console
              console.log('debug:flex.error_unhandled', {
                name: (error as { name?: string }).name,
                constructor: (error as { constructor?: { name?: string } }).constructor?.name,
                message: (error as { message?: string }).message
              })
            }

            throw error
          }
        }

      await this.persistence.saveRunContext(runId, runContext.snapshot())
      this.emittedHitlResolutions.delete(runId)
      if (resolvedDecisionResult) {
        return resolvedDecisionResult
      }
      return { runId, status: 'completed', output: finalOutput }
    }

    let planSnapshot: FlexPlanNodeSnapshot[] = []
    try {
      const { plan: initialPlan } = await requestPlan('initial')
      activePlan = initialPlan
      activePlanVersion = activePlan.version

      planSnapshot = activePlan.nodes.map((node) => ({
        nodeId: node.id,
        capabilityId: node.capabilityId,
        label: node.label,
        status: 'pending',
        context: node.bundle,
        facets: node.facets,
        contracts: node.contracts,
        provenance: node.provenance,
        metadata: node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : null,
        rationale: node.rationale && node.rationale.length ? [...node.rationale] : null
      }))
      await this.persistence.savePlanSnapshot(runId, activePlan.version, planSnapshot, {
        facets: runContext.snapshot(),
        schemaHash: schemaHashValue,
        edges: activePlan.edges,
      planMetadata: activePlan.metadata,
      pendingState: {
        completedNodeIds: [],
        nodeOutputs: {},
        policyActions: [],
        policyAttempts: {}
      }
    })
      await emitEvent({
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
              const derived =
                node.derivedCapability?.fromCapabilityId &&
                typeof node.derivedCapability.fromCapabilityId === 'string'
                  ? { fromCapabilityId: node.derivedCapability.fromCapabilityId }
                  : undefined
              const metadata =
                node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : undefined
              return {
                id: node.id,
                capabilityId: node.capabilityId,
                label: node.label,
                kind: node.kind,
                status: 'pending',
                ...(contracts ? { contracts } : {}),
                ...(facets ? { facets } : {}),
                ...(derived ? { derivedCapability: derived } : {}),
                ...(metadata ? { metadata } : {})
              }
            }),
            metadata: activePlan.metadata
          }
        }
      })

      await this.persistence.updateStatus(runId, 'running')
      let finalOutput: Record<string, unknown> | null = null
      let pendingState:
        | {
            completedNodeIds: string[]
            nodeOutputs: Record<string, Record<string, unknown>>
            facets: RunContextSnapshot
            policyActions?: PendingPolicyActionState[]
            policyAttempts?: Record<string, number>
            mode?: RuntimePolicySnapshotMode
          }
        | undefined

      while (!finalOutput) {
        if (resolvedDecisionResult) {
          return resolvedDecisionResult
        }
        try {
          const result = await this.engine.execute(runId, executionEnvelope, activePlan, {
            onEvent: emitEvent,
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
            onStart: pendingStartupEffect ? () => consumeStartupEffect() : undefined,
            onNodeComplete: ({ node }) => this.policyNormalizer.evaluateRuntimeEffect(normalizedPolicies, node),
            initialState: pendingState,
            runContext,
            schemaHash: schemaHashValue
          })
          finalOutput = result
        } catch (error) {
          if (error instanceof ReplanRequestedError) {
            const trigger = error.trigger
            pendingState = {
              completedNodeIds: error.state.completedNodeIds,
              nodeOutputs: error.state.nodeOutputs,
              facets: error.state.facets,
              ...(error.state.policyActions ? { policyActions: error.state.policyActions } : {}),
              ...(error.state.policyAttempts ? { policyAttempts: error.state.policyAttempts } : {})
            }
            await emitEvent({
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
            activePlanVersion = activePlan.version

            planSnapshot = activePlan.nodes.map((node) => ({
              nodeId: node.id,
              capabilityId: node.capabilityId,
              label: node.label,
              status: pendingState!.completedNodeIds.includes(node.id) ? 'completed' : 'pending',
              context: node.bundle,
              output: pendingState!.nodeOutputs[node.id] ?? null,
              facets: node.facets,
              contracts: node.contracts,
              provenance: node.provenance,
              metadata: node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : null,
              rationale: node.rationale && node.rationale.length ? [...node.rationale] : null
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
              facets: pendingState!.facets,
              schemaHash: schemaHashValue,
              edges: activePlan.edges,
              planMetadata: activePlan.metadata,
              pendingState: {
                completedNodeIds: pendingState!.completedNodeIds,
                nodeOutputs: pendingState!.nodeOutputs,
                policyActions: pendingState!.policyActions ?? [],
                policyAttempts: pendingState!.policyAttempts ?? {},
                mode: pendingState!.mode
              }
            })
            await emitEvent({
              type: 'plan_updated',
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                runId,
                previousVersion,
                version: activePlan.version,
                trigger,
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
                  const derived =
                    node.derivedCapability?.fromCapabilityId &&
                    typeof node.derivedCapability.fromCapabilityId === 'string'
                      ? { fromCapabilityId: node.derivedCapability.fromCapabilityId }
                      : undefined
                  const metadata =
                    node.metadata && Object.keys(node.metadata).length ? { ...node.metadata } : undefined
                  return {
                    id: node.id,
                    capabilityId: node.capabilityId,
                    label: node.label,
                    kind: node.kind,
                    status: pendingState!.completedNodeIds.includes(node.id) ? 'completed' : 'pending',
                    ...(contracts ? { contracts } : {}),
                    ...(facets ? { facets } : {}),
                    ...(derived ? { derivedCapability: derived } : {}),
                    ...(metadata ? { metadata } : {})
                  }
                }),
                metadata: activePlan.metadata
              }
            })
            continue
          }

          if (isRuntimePolicyFailureError(error)) {
            await this.persistence.saveRunContext(runId, runContext.snapshot())
            await this.persistence.updateStatus(runId, 'failed')
            await emitEvent({
              type: 'complete',
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                status: 'failed',
                error: error.message,
                policyId: error.policyId
              }
            })
            this.emittedHitlResolutions.delete(runId)
            return { runId, status: 'failed', output: null }
          }

          if (isFlexValidationError(error)) {
            await this.persistence.saveRunContext(runId, runContext.snapshot())
            await this.persistence.updateStatus(runId, 'failed')
            await emitEvent({
              type: 'complete',
              timestamp: new Date().toISOString(),
              runId,
              payload: {
                status: 'failed',
                error: error.message,
                scope: error.scope
              }
            })
            this.emittedHitlResolutions.delete(runId)
            return { runId, status: 'failed', output: null }
          }

          if (process.env.DEBUG_FLEX_ERRORS === '1') {
            // eslint-disable-next-line no-console
            console.log('debug:flex.error_unhandled', {
              name: (error as { name?: string }).name,
              constructor: (error as { constructor?: { name?: string } }).constructor?.name,
              message: (error as { message?: string }).message
            })
          }
          throw error
        }
      }

      await this.persistence.saveRunContext(runId, runContext.snapshot())
      await this.persistence.updateStatus(runId, 'completed')
      this.emittedHitlResolutions.delete(runId)
      if (resolvedDecisionResult) {
        return resolvedDecisionResult
      }
      return { runId, status: 'completed', output: finalOutput }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    if (error instanceof AwaitingHumanInputError) {
      await this.persistence.saveRunContext(runId, runContext.snapshot())
      await this.persistence.updateStatus(runId, 'awaiting_human')
      return { runId, status: 'awaiting_human', output: null }
    }
    if (error instanceof HitlPauseError || error instanceof RunPausedError) {
      await this.persistence.saveRunContext(runId, runContext.snapshot())
      await this.persistence.updateStatus(runId, 'awaiting_hitl')
      return { runId, status: 'awaiting_hitl', output: null }
    }
      const status: 'failed' | 'cancelled' = error.name === 'AbortError' ? 'cancelled' : 'failed'
      await this.persistence.updateStatus(runId, status)

      await emitEvent({
        type: 'log',
        timestamp: new Date().toISOString(),
        message: error.message,
        payload: { runId }
      })
      this.emittedHitlResolutions.delete(runId)
      throw err
    }
  }

  private rehydratePlan(
    existing: { run: FlexRunRecord; nodes: FlexPlanNodeSnapshot[] },
    envelope: TaskEnvelope,
    snapshotRow?: FlexPlanSnapshotRow | null
  ): FlexPlan {
    const snapshotPayload =
      snapshotRow && snapshotRow.snapshot && typeof snapshotRow.snapshot === 'object'
        ? (snapshotRow.snapshot as {
            nodes?: Array<Record<string, unknown>>
            edges?: FlexPlanEdge[]
            metadata?: Record<string, unknown>
          })
        : null

    const clone = <T>(value: T): T =>
      value == null ? (value as T) : JSON.parse(JSON.stringify(value)) as T

    const snapshotNodeMap = new Map<
      string,
      {
        capabilityId?: string | null
        label?: string | null
        status?: string
        context?: ContextBundle | null
        output?: Record<string, unknown> | null
        facets?: FlexPlanNodeFacets | null
        contracts?: FlexPlanNodeContracts | null
        provenance?: FlexPlanNodeProvenance | null
        metadata?: Record<string, unknown> | null
        rationale?: string[] | null
      }
    >()

    if (Array.isArray(snapshotPayload?.nodes)) {
      for (const raw of snapshotPayload!.nodes!) {
        if (raw && typeof raw === 'object' && typeof raw.nodeId === 'string') {
          snapshotNodeMap.set(raw.nodeId, {
            capabilityId: typeof raw.capabilityId === 'string' ? raw.capabilityId : null,
            label: typeof raw.label === 'string' ? raw.label : null,
            status: typeof raw.status === 'string' ? raw.status : undefined,
            context: (raw.context as ContextBundle | null | undefined) ?? null,
            output: (raw.output as Record<string, unknown> | null | undefined) ?? null,
            facets: (raw.facets as FlexPlanNodeFacets | null | undefined) ?? null,
            contracts: (raw.contracts as FlexPlanNodeContracts | null | undefined) ?? null,
            provenance: (raw.provenance as FlexPlanNodeProvenance | null | undefined) ?? null,
            metadata: (raw.metadata as Record<string, unknown> | null | undefined) ?? null,
            rationale: Array.isArray(raw.rationale) ? (raw.rationale as string[]) : null
          })
        }
      }
    }

    const edges: FlexPlanEdge[] = Array.isArray(snapshotPayload?.edges)
      ? snapshotPayload!.edges!
          .filter(
            (edge): edge is FlexPlanEdge =>
              Boolean(edge) && typeof edge.from === 'string' && typeof edge.to === 'string'
          )
          .map((edge) => ({
            from: edge.from,
            to: edge.to,
            ...(edge.reason ? { reason: edge.reason } : {})
          }))
      : []

    const baseMetadata =
      snapshotPayload?.metadata && typeof snapshotPayload.metadata === 'object'
        ? clone(snapshotPayload.metadata)
        : {}

    const nodes = existing.nodes.map((node) => {
      const snapshotNode = snapshotNodeMap.get(node.nodeId)
      const snapshotContracts = snapshotNode?.contracts
      const nodeContracts: FlexPlanNodeContracts =
        snapshotContracts && typeof snapshotContracts === 'object' && snapshotContracts.output
          ? {
              ...(snapshotContracts.input ? { input: clone(snapshotContracts.input) } : {}),
              output: clone(snapshotContracts.output)
            }
          : { output: clone(envelope.outputContract) }

      const snapshotFacets = snapshotNode?.facets
      const facets: FlexPlanNodeFacets = {
        input: Array.isArray(snapshotFacets?.input) ? [...snapshotFacets.input] : [],
        output: Array.isArray(snapshotFacets?.output) ? [...snapshotFacets.output] : []
      }

      const provenance: FlexPlanNodeProvenance = {}
      if (snapshotNode?.provenance?.input) {
        provenance.input = snapshotNode.provenance.input.map((entry) => clone(entry))
      }
      if (snapshotNode?.provenance?.output) {
        provenance.output = snapshotNode.provenance.output.map((entry) => clone(entry))
      }

      const rationale = Array.isArray(snapshotNode?.rationale) ? [...snapshotNode.rationale] : []

      const nodeMetadata =
        snapshotNode?.metadata && typeof snapshotNode.metadata === 'object'
          ? { ...snapshotNode.metadata }
          : {}

      const capabilityId = snapshotNode?.capabilityId ?? node.capabilityId ?? 'unknown'
      const label = snapshotNode?.label ?? node.label ?? node.nodeId
      const capabilityLabel =
        typeof nodeMetadata.capabilityLabel === 'string'
          ? (nodeMetadata.capabilityLabel as string)
          : label

      const kindRaw =
        typeof nodeMetadata.kind === 'string'
          ? (nodeMetadata.kind as string)
          : typeof (nodeMetadata as any)?.plannerStage === 'string'
          ? ((nodeMetadata as any).plannerStage as string)
          : undefined
      const allowedKinds: FlexPlanNodeKind[] = ['structuring', 'branch', 'execution', 'transformation', 'validation', 'fallback']
      const kind: FlexPlanNodeKind =
        kindRaw && allowedKinds.includes(kindRaw as FlexPlanNodeKind)
          ? (kindRaw as FlexPlanNodeKind)
          : 'execution'

      const capabilityVersion =
        typeof nodeMetadata.capabilityVersion === 'string' ? (nodeMetadata.capabilityVersion as string) : undefined
      const derivedCapability =
        nodeMetadata.derivedCapability &&
        typeof nodeMetadata.derivedCapability === 'object' &&
        typeof (nodeMetadata.derivedCapability as { fromCapabilityId?: unknown }).fromCapabilityId === 'string'
          ? { fromCapabilityId: (nodeMetadata.derivedCapability as { fromCapabilityId: string }).fromCapabilityId }
          : undefined

      const nodeForBundle: FlexPlanNodeSnapshot =
        snapshotNode?.context && !node.context ? { ...node, context: snapshotNode.context } : node
      const bundle = this.normalizeContextBundle(existing.run.runId, nodeForBundle, envelope)

      return {
        id: node.nodeId,
        kind,
        capabilityId,
        capabilityLabel,
        label,
        capabilityVersion,
        ...(derivedCapability ? { derivedCapability } : {}),
        bundle,
        contracts: nodeContracts,
        facets,
        provenance,
        rationale,
        metadata: nodeMetadata
      }
    })

    return {
      runId: existing.run.runId,
      version: snapshotRow?.planVersion ?? existing.run.planVersion ?? 1,
      createdAt: new Date().toISOString(),
      nodes,
      edges,
      metadata: { ...baseMetadata, resumed: true }
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
