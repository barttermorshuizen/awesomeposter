// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { CapabilityRegistration, FlexEvent, TaskEnvelope } from '@awesomeposter/shared'
import { parseTaskPolicies } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'
import { FlexExecutionEngine } from '../src/services/flex-execution-engine'
import { FlexPlanner } from '../src/services/flex-planner'
import { HUMAN_CLARIFY_CAPABILITY, HUMAN_CLARIFY_CAPABILITY_ID } from '../src/agents/human-clarify-brief'
import type { HitlRunState, HitlRequestRecord, HitlRequestPayload, HitlResponseInput } from '@awesomeposter/shared'
import type { PlannerServiceInterface, PlannerServiceInput } from '../src/services/planner-service'
import type { PendingPolicyActionState, RuntimePolicySnapshotMode } from '../src/services/runtime-policy-types'

class MemoryFlexPersistence {
  runs = new Map<string, any>()
  statuses = new Map<string, string>()
  nodes = new Map<string, any>()
  results = new Map<string, Record<string, unknown>>() 
  planVersions = new Map<string, number>()
  pendingResults = new Map<string, Record<string, unknown>>()
  contexts = new Map<string, Record<string, unknown>>()
  snapshots = new Map<string, any>()
  outputs = new Map<string, any>()

  async createOrUpdateRun(record: any) {
    this.runs.set(record.runId, { ...record })
    this.statuses.set(record.runId, record.status)
  }

  async updateStatus(runId: string, status: string) {
    this.statuses.set(runId, status)
    const run = this.runs.get(runId)
    if (run) run.status = status
  }

  async savePlanSnapshot(
    runId: string,
    version: number,
    nodes: any[],
    options: {
      facets?: Record<string, unknown>
      schemaHash?: string | null
      edges?: unknown
      planMetadata?: Record<string, unknown>
      pendingState?: {
        completedNodeIds: string[]
        nodeOutputs: Record<string, Record<string, unknown>>
        policyActions?: PendingPolicyActionState[]
        policyAttempts?: Record<string, number>
        mode?: RuntimePolicySnapshotMode
      }
    } = {}
  ) {
    this.planVersions.set(runId, version)
    const existingKeys = new Set<string>()
    nodes.forEach((node) => {
      const key = `${runId}:${node.nodeId}`
      this.nodes.set(key, { ...node })
      existingKeys.add(key)
    })
    for (const key of Array.from(this.nodes.keys())) {
      if (key.startsWith(`${runId}:`) && !existingKeys.has(key)) {
        this.nodes.delete(key)
      }
    }
    const run = this.runs.get(runId)
    if (run) run.planVersion = version
    if (options.facets) {
      this.contexts.set(runId, { ...options.facets })
    }
    const pendingNodeIds = nodes
      .filter((node) => node.status !== 'completed')
      .map((node) => node.nodeId)
    this.snapshots.set(runId, {
      planVersion: version,
      snapshot: {
        nodes: nodes.map((node) => ({ ...node })),
        edges: Array.isArray(options.edges) ? [...options.edges] : [],
        metadata: options.planMetadata ? { ...options.planMetadata } : {},
        ...(options.pendingState
          ? {
              pendingState: {
                completedNodeIds: [...options.pendingState.completedNodeIds],
                nodeOutputs: { ...options.pendingState.nodeOutputs },
                ...(options.pendingState.policyActions
                  ? { policyActions: options.pendingState.policyActions.map((action) => ({ ...action })) }
                  : {}),
                ...(options.pendingState.policyAttempts
                  ? { policyAttempts: { ...options.pendingState.policyAttempts } }
                  : {}),
                ...(options.pendingState.mode ? { mode: options.pendingState.mode } : {})
              }
            }
          : {})
      },
      facets: options.facets ? { ...options.facets } : null,
      schemaHash: options.schemaHash ?? null,
      pendingNodeIds
    })
  }

  async markNode(runId: string, nodeId: string, updates: any) {
    const key = `${runId}:${nodeId}`
    const current = this.nodes.get(key) || { nodeId }
    this.nodes.set(key, { ...current, ...updates })
  }

  async recordResult(runId: string, result: Record<string, unknown>, options: any = {}) {
    this.results.set(runId, result)
    this.outputs.set(runId, { result: { ...result }, options: { ...options } })
    const run = this.runs.get(runId)
    if (run) run.result = result
    const status = options.status ?? 'completed'
    this.statuses.set(runId, status)
    if (run) run.status = status
  }

  async ensure() {}

  async recordPendingResult(runId: string, result: Record<string, unknown>) {
    this.pendingResults.set(runId, result)
    const run = this.runs.get(runId)
    if (run) run.result = result
  }

  async saveRunContext(runId: string, snapshot: Record<string, unknown>) {
    this.contexts.set(runId, { ...snapshot })
  }

  async loadFlexRun(runId: string) {
    const run = this.runs.get(runId)
    if (!run) return null
    const nodeEntries = Array.from(this.nodes.entries())
      .filter(([key]) => key.startsWith(`${runId}:`))
      .map(([, value]) => ({ ...value }))
    return {
      run: {
        runId,
        threadId: run.threadId ?? null,
        status: run.status ?? 'pending',
        objective: run.objective ?? null,
        envelope: run.envelope,
        schemaHash: run.schemaHash ?? null,
        metadata: run.metadata ?? null,
        result: this.results.get(runId) ?? this.pendingResults.get(runId) ?? null,
        planVersion: run.planVersion ?? 1,
        contextSnapshot: this.contexts.get(runId) ?? undefined
      },
      nodes: nodeEntries
    }
  }

  async findFlexRunByThreadId(threadId: string) {
    const entry = Array.from(this.runs.values()).find((run) => run.threadId === threadId)
    if (!entry) return null
    return this.loadFlexRun(entry.runId)
  }

  async loadPlanSnapshot(runId: string, planVersion?: number) {
    const record = this.snapshots.get(runId)
    if (!record) return null
    if (typeof planVersion === 'number' && record.planVersion !== planVersion) {
      return null
    }
    return record
  }

  async listPendingHumanTasks(filters: { assignedTo?: string; role?: string; status?: string } = {}) {
    const tasks: Array<Record<string, unknown>> = []
    for (const [key, value] of this.nodes.entries()) {
      if (!key.includes(':')) continue
      const [runId, nodeId] = key.split(':')
      if (value.status !== 'awaiting_human') continue
      const run = this.runs.get(runId)
      const context = (value.context ?? {}) as Record<string, unknown>
      const assignment = (context.assignment ?? {}) as Record<string, unknown>
      const defaults = assignment.defaults ? { ...(assignment.defaults as Record<string, unknown>) } : null
      const metadataSource = assignment.metadata ? { ...(assignment.metadata as Record<string, unknown>) } : {}
      const ctxInputs = (context.currentInputs ?? context.inputs) as Record<string, unknown> | undefined
      if (ctxInputs) {
        metadataSource.currentInputs = { ...ctxInputs }
      }
      const ctxOutput = (context.currentOutput ?? context.priorOutputs) as Record<string, unknown> | undefined
      if (ctxOutput) {
        metadataSource.currentOutput = { ...ctxOutput }
      }
      if (context.runContextSnapshot) {
        metadataSource.runContextSnapshot = { ...(context.runContextSnapshot as Record<string, unknown>) }
      }
      const metadata = Object.keys(metadataSource).length ? metadataSource : null
      const status = (assignment.status as string | undefined) ?? 'awaiting_submission'
      const task = {
        taskId: (assignment.assignmentId as string | undefined) ?? key,
        runId,
        nodeId,
        capabilityId: value.capabilityId ?? null,
        label: value.label ?? null,
        status,
        assignedTo: (assignment.assignedTo as string | undefined) ?? null,
        role: (assignment.role as string | undefined) ?? null,
        dueAt: (assignment.dueAt as string | undefined) ?? null,
        priority: (assignment.priority as string | undefined) ?? null,
        instructions: (assignment.instructions as string | undefined) ?? null,
        defaults,
        metadata,
        contracts: context.contracts ? { ...(context.contracts as Record<string, unknown>) } : null,
        facets: context.facets ? { ...(context.facets as Record<string, unknown>) } : null,
        facetProvenance: context.facetProvenance
          ? { ...(context.facetProvenance as Record<string, unknown>) }
          : null
      }
      tasks.push(task)
    }
    return tasks.filter((task) => {
      if (filters.assignedTo && task.assignedTo !== filters.assignedTo) return false
      if (filters.role && task.role !== filters.role) return false
      if (filters.status && task.status !== filters.status) return false
      return true
    })
  }
}

function createHumanCoordinator(
  persistence: MemoryFlexPersistence,
  options: { humanCapability?: CapabilityRegistration } = {}
) {
  const humanCapability = options.humanCapability ?? HUMAN_CLARIFY_CAPABILITY
  const aiCapability = {
    capabilityId: 'ContentAgent.generateDraft',
    status: 'active' as const,
    version: '1.0.0',
    displayName: 'Content Generator',
    summary: 'Produces final output from clarification response.',
    inputContract: { mode: 'facets' as const, facets: ['clarificationResponse'] },
    outputContract: {
      mode: 'json_schema' as const,
      schema: {
        type: 'object',
        required: ['finalOutput'],
        properties: {
          finalOutput: {
            type: 'object',
            required: ['copy'],
            properties: {
              copy: { type: 'string' }
            }
          }
        }
      }
    },
    inputFacets: ['clarificationResponse'],
    outputFacets: ['finalOutput'],
    metadata: {}
  }

  const capabilityRegistry = {
    async getSnapshot() {
      const active = [humanCapability, aiCapability]
      return { active, all: active }
    },
    async listActive() {
      return [humanCapability, aiCapability]
    },
    async getCapabilityById(id: string) {
      if (id === humanCapability.capabilityId) return humanCapability
      if (id === aiCapability.capabilityId) return aiCapability
      return undefined
    }
  }

 const plannerService = {
   async proposePlan() {
     return {
       nodes: [
         {
           stage: 'clarify',
           kind: 'execution',
           capabilityId: HUMAN_CLARIFY_CAPABILITY_ID,
           inputFacets:
             humanCapability.inputContract.mode === 'facets' ? humanCapability.inputContract.facets : [],
           outputFacets:
             humanCapability.outputContract.mode === 'facets' ? humanCapability.outputContract.facets : [],
           rationale: ['Human clarification required before generation']
         },
         {
           stage: 'generate',
           kind: 'execution',
           capabilityId: aiCapability.capabilityId,
           inputFacets: aiCapability.inputFacets,
           outputFacets: aiCapability.outputFacets,
           rationale: ['Use clarified data to produce final asset']
         }
       ]
     }
   }
 }

  const validationService = {
    validate: () => ({ ok: true, diagnostics: [] })
  }

  const planner = new FlexPlanner(
    {
      capabilityRegistry: capabilityRegistry as any,
      plannerService: plannerService as any,
      validationService: validationService as any
    }
  )

  const runtime = {
    runStructured: vi.fn().mockResolvedValue({
      finalOutput: {
        copy: 'Generated launch copy'
      }
    })
  }

  const engine = new FlexExecutionEngine(persistence as any, {
    runtime: runtime as any,
    capabilityRegistry: capabilityRegistry as any
  })

  const hitlService = {
    getMaxRequestsPerRun: () => 3,
    async loadRunState() {
      return { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }
    }
  }

  const coordinator = new FlexRunCoordinator(persistence as any, planner, engine, hitlService as any)
  return { coordinator, runtime, engine }
}

describe('FlexRunCoordinator resume with human submission', () => {
  it('completes run after human clarification resume', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator, runtime } = createHumanCoordinator(persistence)

    const envelope: TaskEnvelope = {
      objective: 'Launch announcement copy',
      inputs: {
        objectiveBrief: { goal: 'Announce new product' },
        toneOfVoice: 'uplifting',
        audienceProfile: { persona: 'marketers' },
        clarificationRequest: {
          budget: true,
          timeline: true
        }
      },
      policies: parseTaskPolicies({ planner: {}, runtime: [] }),
      outputContract: { mode: 'freeform' }
    }

    const events: FlexEvent[] = []
    const firstRun = await coordinator.run(envelope, {
      correlationId: 'cid_human_start',
      onEvent: async (frame) => events.push(frame)
    })

    expect(firstRun.status).toBe('awaiting_human')
    expect(persistence.runs.has(firstRun.runId)).toBe(true)
    const persisted = await persistence.loadFlexRun(firstRun.runId)
    expect(persisted).toBeTruthy()
    const taskList = await persistence.listPendingHumanTasks()
    expect(taskList).toHaveLength(1)
    expect(taskList[0]?.status).toBe('awaiting_submission')

    const submissionOutput = {
      clarificationResponse: {
        budget: '$10k',
        timeline: 'Q4'
      }
    }

    const resumeEvents: FlexEvent[] = []
    const storedEnvelope = (await persistence.loadFlexRun(firstRun.runId))!.run.envelope as TaskEnvelope
    const resumeEnvelope: TaskEnvelope = {
      ...storedEnvelope,
      constraints: {
        ...((storedEnvelope.constraints as Record<string, unknown> | undefined) ?? {}),
        resumeRunId: firstRun.runId
      },
      metadata: {
        ...((storedEnvelope.metadata as Record<string, unknown> | undefined) ?? {}),
        runId: firstRun.runId,
        resume: true
      }
    }

    const resumeResult = await coordinator.run(resumeEnvelope, {
      correlationId: 'cid_human_resume',
      onEvent: async (frame) => resumeEvents.push(frame),
      resumeSubmission: {
        nodeId: taskList[0]?.nodeId as string,
        output: submissionOutput,
        submittedAt: new Date().toISOString()
      }
    })

    expect(resumeResult.status).toBe('completed')
    expect(resumeResult.output).toMatchObject({ finalOutput: { copy: 'Generated launch copy' } })
    expect(runtime.runStructured).toHaveBeenCalledTimes(1)

    const humanCompleteEvent = resumeEvents.find((evt) => evt.type === 'node_complete' && evt.nodeId === taskList[0]?.nodeId)
    expect(humanCompleteEvent).toBeTruthy()
    expect((humanCompleteEvent?.payload as any)?.executorType).toBe('human')
  })

  it('keeps run awaiting_human when resume validation fails', async () => {
    const persistence = new MemoryFlexPersistence()
    const strictHumanCapability: CapabilityRegistration = {
      ...HUMAN_CLARIFY_CAPABILITY,
      outputContract: {
        mode: 'json_schema',
        schema: {
          type: 'object',
          required: ['clarificationResponse'],
          properties: {
            clarificationResponse: {
              type: 'object',
              required: ['answers'],
              properties: {
                answers: {
                  type: 'array',
                  minItems: 1,
                  items: {
                    type: 'object',
                    required: ['field', 'value'],
                    properties: {
                      field: { type: 'string' },
                      value: { type: 'string' }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }

    const { coordinator, runtime } = createHumanCoordinator(persistence, {
      humanCapability: strictHumanCapability
    })

    const envelope: TaskEnvelope = {
      objective: 'Launch announcement copy',
      inputs: {
        objectiveBrief: { goal: 'Announce new product' },
        toneOfVoice: 'uplifting',
        audienceProfile: { persona: 'marketers' },
        clarificationRequest: {
          budget: true,
          timeline: true
        }
      },
      policies: parseTaskPolicies({ planner: {}, runtime: [] }),
      outputContract: { mode: 'freeform' }
    }

    const events: FlexEvent[] = []
    const firstRun = await coordinator.run(envelope, {
      correlationId: 'cid_human_start_invalid',
      onEvent: async (frame) => events.push(frame)
    })

    expect(firstRun.status).toBe('awaiting_human')

    const taskList = await persistence.listPendingHumanTasks()
    expect(taskList).toHaveLength(1)
    const humanTask = taskList[0]
    expect(humanTask?.nodeId).toBeTruthy()

    const storedEnvelope = (await persistence.loadFlexRun(firstRun.runId))!.run.envelope as TaskEnvelope
    const resumeEnvelope: TaskEnvelope = {
      ...storedEnvelope,
      constraints: {
        ...((storedEnvelope.constraints as Record<string, unknown> | undefined) ?? {}),
        resumeRunId: firstRun.runId
      },
      metadata: {
        ...((storedEnvelope.metadata as Record<string, unknown> | undefined) ?? {}),
        runId: firstRun.runId,
        resume: true
      }
    }

    const resumeEvents: FlexEvent[] = []
    const resumeResult = await coordinator.run(resumeEnvelope, {
      correlationId: 'cid_human_resume_invalid',
      onEvent: async (frame) => resumeEvents.push(frame),
      resumeSubmission: {
        nodeId: humanTask?.nodeId as string,
        output: {},
        submittedAt: new Date().toISOString()
      }
    })

    expect(resumeResult.status).toBe('awaiting_human')
    expect(resumeResult.output).toBeNull()
    expect(runtime.runStructured).not.toHaveBeenCalled()
    expect(persistence.statuses.get(firstRun.runId)).toBe('awaiting_human')

    const nodeKey = `${firstRun.runId}:${humanTask?.nodeId}`
    const nodeRecord = persistence.nodes.get(nodeKey)
    expect(nodeRecord?.status).toBe('awaiting_human')
    expect(nodeRecord?.error).toMatchObject({
      message: expect.stringContaining('validation failed'),
      name: 'FlexValidationError'
    })

    const validationEvent = resumeEvents.find((evt) => evt.type === 'validation_error')
    expect(validationEvent).toBeTruthy()
    const nodeErrorEvent = resumeEvents.find((evt) => evt.type === 'node_error')
    expect(nodeErrorEvent).toBeTruthy()
    expect((nodeErrorEvent?.payload as any)?.executorType).toBe('human')

    const pendingTasks = await persistence.listPendingHumanTasks()
    expect(pendingTasks).toHaveLength(1)
    expect(pendingTasks[0]?.status).toBe('awaiting_submission')
  })

  it('fails run and emits decline events when operator declines task', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator } = createHumanCoordinator(persistence)

    const envelope: TaskEnvelope = {
      objective: 'Launch announcement copy',
      inputs: {
        objectiveBrief: { goal: 'Announce new product' },
        toneOfVoice: 'uplifting',
        audienceProfile: { persona: 'marketers' }
      },
      policies: parseTaskPolicies({ planner: {}, runtime: [] }),
      outputContract: { mode: 'freeform' }
    }

    const initialEvents: FlexEvent[] = []
    const firstRun = await coordinator.run(envelope, {
      correlationId: 'cid_decline_start',
      onEvent: async (frame) => initialEvents.push(frame)
    })

    expect(firstRun.status).toBe('awaiting_human')
    const pendingTasks = await persistence.listPendingHumanTasks()
    expect(pendingTasks).toHaveLength(1)
    const task = pendingTasks[0]
    expect(task?.status).toBe('awaiting_submission')

    const stored = await persistence.loadFlexRun(firstRun.runId)
    const resumeEnvelope = {
      ...(stored!.run.envelope as TaskEnvelope),
      constraints: {
        ...(((stored!.run.envelope as TaskEnvelope).constraints as Record<string, unknown> | undefined) ?? {}),
        resumeRunId: firstRun.runId
      },
      metadata: {
        ...(((stored!.run.envelope as TaskEnvelope).metadata as Record<string, unknown> | undefined) ?? {}),
        runId: firstRun.runId,
        resume: true
      }
    }

    const declineEvents: FlexEvent[] = []
    const result = await coordinator.run(resumeEnvelope, {
      correlationId: 'cid_decline_resume',
      onEvent: async (frame) => declineEvents.push(frame),
      resumeSubmission: {
        nodeId: task?.nodeId as string,
        decline: {
          reason: 'Insufficient details',
          note: 'Need budget before proceeding'
        },
        submittedAt: new Date().toISOString()
      }
    })

    expect(result.status).toBe('failed')
    expect(result.output).toBeNull()
    expect(persistence.statuses.get(firstRun.runId)).toBe('failed')

    const nodeComplete = declineEvents.find((evt) => evt.type === 'node_complete')
    expect(nodeComplete).toBeTruthy()
    expect(nodeComplete?.payload).toMatchObject({
      outcome: 'declined',
      decline: {
        reason: 'Insufficient details',
        note: 'Need budget before proceeding'
      }
    })

    const completeEvent = declineEvents.find((evt) => evt.type === 'complete')
    expect(completeEvent).toBeTruthy()
    expect((completeEvent?.payload as any)?.status).toBe('failed')

    const refreshedTasks = await persistence.listPendingHumanTasks()
    expect(refreshedTasks).toHaveLength(0)
  })
})
