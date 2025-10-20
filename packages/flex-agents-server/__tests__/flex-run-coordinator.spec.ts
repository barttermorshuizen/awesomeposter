// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, TaskEnvelope, HitlRunState, HitlRequestRecord, HitlRequestPayload } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'
import { FlexExecutionEngine } from '../src/services/flex-execution-engine'
import { FlexPlanner } from '../src/services/flex-planner'
import { getHitlContext } from '../src/services/hitl-context'
import { CONTENT_CAPABILITY_ID } from '../src/agents/content-generator'
import { STRATEGY_CAPABILITY_ID } from '../src/agents/strategy-manager'
import { QA_CAPABILITY_ID } from '../src/agents/quality-assurance'
import type { PlannerServiceInterface, PlannerServiceInput } from '../src/services/planner-service'

class MemoryFlexPersistence {
  runs = new Map<string, any>()
  statuses = new Map<string, string>()
  nodes = new Map<string, any>()
  results = new Map<string, Record<string, unknown>>()
  planVersions = new Map<string, number>()
  pendingResults = new Map<string, Record<string, unknown>>()
  contexts = new Map<string, Record<string, unknown>>()
  snapshots = new Map<
    string,
    {
      planVersion: number
      snapshot: { nodes: any[]; edges: any[]; metadata: Record<string, unknown>; pendingState?: { completedNodeIds: string[]; nodeOutputs: Record<string, Record<string, unknown>> } }
      facets: Record<string, unknown> | null
      schemaHash: string | null
      pendingNodeIds: string[]
      createdAt: Date
      updatedAt: Date
    }
  >()
  outputs = new Map<string, any>()

  async createOrUpdateRun(record: any) {
    this.runs.set(record.runId, { ...record })
    if (record.contextSnapshot) {
      this.contexts.set(record.runId, { ...record.contextSnapshot })
    }
    this.statuses.set(record.runId, record.status)
  }

  async updateStatus(runId: string, status: any) {
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
      pendingState?: { completedNodeIds: string[]; nodeOutputs: Record<string, Record<string, unknown>> }
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
    const timestamp = new Date('2025-04-01T12:00:00.000Z')

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
                nodeOutputs: { ...options.pendingState.nodeOutputs }
              }
            }
          : {})
      },
      facets: options.facets ? { ...options.facets } : null,
      schemaHash: options.schemaHash ?? null,
      pendingNodeIds,
      createdAt: timestamp,
      updatedAt: timestamp
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
    const nodes = Array.from(this.nodes.entries())
      .filter(([key]) => key.startsWith(`${runId}:`))
      .map(([, value]) => ({
        nodeId: value.nodeId,
        capabilityId: value.capabilityId,
        label: value.label,
        status: value.status ?? 'completed',
        context: value.context ?? null,
        output: value.output ?? null,
        error: value.error ?? null,
        startedAt: value.startedAt ?? null,
        completedAt: value.completedAt ?? null
      }))
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
      nodes
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
    return {
      runId,
      planVersion: record.planVersion,
      snapshot: record.snapshot,
      facets: record.facets,
      schemaHash: record.schemaHash,
      pendingNodeIds: record.pendingNodeIds,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt
    }
  }
}

class StubHitlService {
  private runId: string | null = null
  state: HitlRunState = { requests: [], responses: [], pendingRequestId: null, deniedCount: 0 }

  getMaxRequestsPerRun() {
    return 3
  }

  async loadRunState(runId: string) {
    this.runId = runId
    return this.state
  }

  async raiseRequest(payload: HitlRequestPayload) {
    if (!this.runId) throw new Error('runId missing in stub hitl service')
    const record: HitlRequestRecord = {
      id: `req_${Math.random().toString(36).slice(2, 8)}`,
      runId: this.runId,
      threadId: this.runId,
      stepId: `${CONTENT_CAPABILITY_ID}_1`,
      stepStatusAtRequest: 'pending',
      originAgent: 'generation',
      payload,
      status: 'pending',
      createdAt: new Date(),
      updatedAt: new Date(),
      metrics: { attempt: this.state.requests.length + 1 }
    }
    this.state = {
      requests: [...this.state.requests, record],
      responses: [...this.state.responses],
      pendingRequestId: record.id,
      deniedCount: this.state.deniedCount
    }
    const ctx = getHitlContext()
    if (ctx) {
      ctx.snapshot = this.state
      ctx.limit.current = this.state.requests.filter((r) => r.status !== 'denied').length
      ctx.onRequest(record, this.state)
    }
    return { status: 'pending' as const, request: record }
  }

  async applyResponses() {
    return this.state
  }

  parseEnvelope() {
    return null
  }
}

function createPlannerServiceStub(options: { firstPlanInvalid?: boolean } = {}): PlannerServiceInterface {
  let callCount = 0
  return {
    async proposePlan({ scenario }) {
      callCount += 1
      if (options.firstPlanInvalid && callCount === 1) {
        return {
          nodes: [
            {
              stage: 'strategy',
              kind: 'structuring',
              capabilityId: 'missing_capability',
              inputFacets: ['objectiveBrief'],
              outputFacets: ['writerBrief']
            }
          ]
        }
      }

      const nodes = [
        {
          stage: 'strategy',
          kind: 'structuring',
          capabilityId: STRATEGY_CAPABILITY_ID,
          inputFacets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'],
          outputFacets: ['writerBrief', 'planKnobs', 'strategicRationale'],
          derived: false,
          rationale: ['planner_recommendation']
        },
        {
          stage: 'generation',
          kind: 'execution',
          capabilityId: CONTENT_CAPABILITY_ID,
          inputFacets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'],
          outputFacets: ['copyVariants'],
          derived: scenario !== 'linkedin_post_variants',
          rationale: ['planner_recommendation'],
          instructions: ['Generate platform-appropriate copy variants']
        },
        {
          stage: 'qa',
          kind: 'validation',
          capabilityId: QA_CAPABILITY_ID,
          inputFacets: ['copyVariants', 'writerBrief', 'qaRubric'],
          outputFacets: ['qaFindings', 'recommendationSet'],
          derived: true,
          rationale: ['planner_recommendation']
        }
      ]
      return {
        nodes,
        metadata: {
          provider: 'planner-stub',
          model: 'stub-1.0'
        }
      }
    }
  }
}

function createCoordinator(
  persistence: MemoryFlexPersistence,
  options: { plannerService?: PlannerServiceInterface } = {}
) {
  const strategyCapability = {
    capabilityId: STRATEGY_CAPABILITY_ID,
    status: 'active' as const,
    version: '1.0.0',
    displayName: 'Strategy Manager',
    summary: 'Plans rationale and writer brief.',
    inputContract: { mode: 'facets' as const, facets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'] },
    outputContract: { mode: 'facets' as const, facets: ['writerBrief', 'planKnobs', 'strategicRationale'] },
    inputFacets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'],
    outputFacets: ['writerBrief', 'planKnobs', 'strategicRationale'],
    metadata: { scenarios: ['briefing', 'plan_structuring'] }
  }

  const contentCapability = {
    capabilityId: CONTENT_CAPABILITY_ID,
    status: 'active' as const,
    version: '1.0.0',
    displayName: 'LinkedIn Variants',
    summary: 'Generates LinkedIn post variants from envelope context.',
    inputContract: { mode: 'facets' as const, facets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'] },
    outputContract: {
      mode: 'json_schema' as const,
      schema: {
        type: 'object',
        required: ['copyVariants'],
        properties: {
          copyVariants: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              required: ['headline', 'body', 'callToAction'],
              properties: {
                headline: { type: 'string', minLength: 5 },
                body: { type: 'string', minLength: 20 },
                callToAction: { type: 'string', minLength: 2 }
              }
            }
          }
        }
      }
    },
    inputFacets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'],
    outputFacets: ['copyVariants'],
    metadata: { scenarios: ['linkedin_post_variants'] }
  }

  const qaCapability = {
    capabilityId: QA_CAPABILITY_ID,
    status: 'active' as const,
    version: '1.0.0',
    displayName: 'Quality Assurance',
    summary: 'Evaluates drafts for policy and quality.',
    inputContract: { mode: 'facets' as const, facets: ['copyVariants', 'writerBrief', 'qaRubric'] },
    outputContract: { mode: 'facets' as const, facets: ['qaFindings', 'recommendationSet'] },
    inputFacets: ['copyVariants', 'writerBrief', 'qaRubric'],
    outputFacets: ['qaFindings', 'recommendationSet'],
    metadata: { scenarios: ['qa_review'] }
  }

  const registry = {
    async listActive() {
      return [strategyCapability, contentCapability, qaCapability]
    },
    async getCapabilityById(id: string) {
      if (id === strategyCapability.capabilityId) return strategyCapability
      if (id === contentCapability.capabilityId) return contentCapability
      if (id === qaCapability.capabilityId) return qaCapability
      return undefined
    },
    async getSnapshot() {
      const active = [strategyCapability, contentCapability, qaCapability]
      return { active, all: active }
    }
  }

  const plannerService = options.plannerService ?? createPlannerServiceStub()

  const planner = new FlexPlanner(
    {
      capabilityRegistry: registry as any,
      plannerService: plannerService
    },
    { now: () => new Date('2025-04-01T12:00:00.000Z') }
  )

  const runtime = {
    runStructured: vi.fn(async (_schema, _messages, options) => {
      const schemaName = (options?.schemaName ?? '').toLowerCase()
      if (schemaName.includes('strategy')) {
        return {
          writerBrief: {
            objective: 'Increase awareness of AwesomePoster retreat culture.',
            audience: 'developer_experience',
            hooks: ['Celebrate the team retreat', 'Highlight developer empowerment']
          },
          planKnobs: {
            formatType: 'text',
            variantCount: 2,
            structure: { lengthLevel: 0.5, scanDensity: 0.4 }
          },
          strategicRationale: 'Use retreat storytelling to humanise the employer brand.'
        }
      }
      if (schemaName.includes('qa') || schemaName.includes('quality')) {
        return {
          qaFindings: ['No policy violations detected', 'Tone matches inspiring intent'],
          recommendationSet: ['Consider adding a CTA variation referencing upcoming roles']
        }
      }
      return {
        copyVariants: [
          {
            headline: 'Team Retreat Spotlight',
            body: 'AwesomePoster just wrapped an unforgettable retreat and is searching for creators who love building tooling for developers.',
            callToAction: 'Join the team'
          },
          {
            headline: 'Build The Future With AwesomePoster',
            body: 'We are expanding our developer experience crew and want teammates who thrive on human-first automation to shape the roadmap.',
            callToAction: 'Apply today'
          }
        ]
      }
    })
  }

  const engine = new FlexExecutionEngine(persistence as any, {
    runtime: runtime as any,
    capabilityRegistry: registry as any
  })

  const hitlService = new StubHitlService()
  return {
    coordinator: new FlexRunCoordinator(persistence as any, planner, engine, hitlService as any),
    hitlService,
    runtime,
    capability: contentCapability
  }
}

function buildEnvelope(overrides: Partial<TaskEnvelope> = {}): TaskEnvelope {
  const overrideInputs = (overrides.inputs as Record<string, unknown> | undefined) ?? {}
  const overridePolicies = (overrides.policies as Record<string, unknown> | undefined) ?? {}
  const overrideConstraints = (overrides.constraints as Record<string, unknown> | undefined) ?? {}
  return {
    objective: overrides.objective ?? 'Create LinkedIn variants for AwesomePoster retreat',
    inputs: {
      channel: 'linkedin',
      audience: 'developer_experience',
      theme: 'company_outing',
      goal: 'attract_new_employees',
      variantCount: 2,
      audienceProfile: {
        persona: 'Developer Experience',
        segments: ['platform_engineers'],
        regions: ['US'],
        painPoints: ['integration complexity']
      },
      toneOfVoice: 'Inspiring & Visionary',
      writerBrief: {
        angle: 'Celebrate the retreat culture',
        keyPoints: ['Team cohesion', 'Developer empowerment'],
        knobs: {
          formatType: 'text',
          hookIntensity: 0.6,
          expertiseDepth: 0.4,
          structure: { lengthLevel: 0.5, scanDensity: 0.4 }
        }
      },
      planKnobs: {
        formatType: 'text',
        variantCount: 2,
        hookIntensity: 0.6,
        expertiseDepth: 0.4,
        structure: { lengthLevel: 0.5, scanDensity: 0.4 }
      },
      qaRubric: {
        checks: ['policy', 'tone', 'objective_fit'],
        thresholds: { readability: 0.6 }
      },
      contextBundles: [
        {
          type: 'company_profile',
          payload: {
            companyName: 'AwesomePoster',
            coreValue: 'Human-first automation',
            recentEvent: 'Summer retreat in Tahoe'
          }
        }
      ],
      ...overrideInputs
    },
    policies: {
      brandVoice: 'inspiring',
      maxTokens: 120,
      ...overridePolicies
    },
    specialInstructions: [
      'Variant A should highlight team culture.',
      'Variant B should highlight career growth opportunities.'
    ],
    metadata: {
      clientId: 'awesomeposter-marketing'
    },
    constraints: { ...overrideConstraints },
    outputContract: overrides.outputContract ?? {
      mode: 'json_schema',
      schema: {
        type: 'object',
        required: ['copyVariants'],
        properties: {
          copyVariants: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              required: ['headline', 'body', 'callToAction'],
              properties: {
                headline: { type: 'string', minLength: 5 },
                body: { type: 'string', minLength: 20 },
                callToAction: { type: 'string' }
              }
            }
          }
        }
      }
    }
  }
}

describe('FlexRunCoordinator', () => {
  it('streams happy-path events and records final output', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator, runtime } = createCoordinator(persistence)
    const events: FlexEvent[] = []

    const result = await coordinator.run(buildEnvelope(), {
      correlationId: 'cid_test',
      onEvent: async (evt) => {
        events.push(evt)
      }
    })

    expect(result.runId).toMatch(/^flex_/)
    expect(result.status).toBe('completed')
    expect(result.output?.copyVariants).toHaveLength(2)
    const firstInvocation = runtime.runStructured.mock.calls[0]
    expect(firstInvocation).toBeDefined()
    const firstUserPrompt =
      firstInvocation?.[1]?.find((entry: { role: string; content: string }) => entry.role === 'user')?.content ?? ''
    expect(firstUserPrompt).toContain('Capability input contract')
    expect(firstUserPrompt).toContain('Capability output contract')
    expect(firstUserPrompt).toContain('Planner stage')
    expect(firstInvocation?.[1]?.find((entry: { role: string; content: string }) => entry.role === 'system')?.content ?? '')
      .toContain('Strategy Manager agent')
    const firstOptions = firstInvocation?.[2] ?? {}
    expect(firstOptions.toolsAllowlist).toEqual(expect.arrayContaining(['strategy_analyze_assets', 'strategy_plan_knobs']))
    expect(events.map((e) => e.type)).toContain('plan_requested')
    expect(events.map((e) => e.type)).toContain('plan_generated')
    expect(events.map((e) => e.type)).toContain('node_start')
    expect(events.map((e) => e.type)).toContain('node_complete')
    expect(events.map((e) => e.type)).toContain('complete')

    const persistedOutput = persistence.outputs.get(result.runId)
    expect(persistedOutput).toBeDefined()
    const recordedPlanVersion = persistedOutput?.options?.planVersion ?? persistedOutput?.options?.snapshot?.planVersion
    if (typeof recordedPlanVersion === 'number') {
      expect(recordedPlanVersion).toBeGreaterThan(0)
    }
    const savedSnapshot = persistence.snapshots.get(result.runId)
    const snapshotRecord = persistedOutput?.options?.snapshot ?? savedSnapshot?.snapshot
    const finalSnapshot = snapshotRecord ?? null
    expect(finalSnapshot).toBeDefined()
    if (finalSnapshot) {
      expect(Array.isArray(finalSnapshot.nodes)).toBe(true)
      expect(finalSnapshot.nodes.length).toBeGreaterThan(0)
      expect(finalSnapshot.nodes?.[0]?.context).toBeDefined()
      expect(finalSnapshot.nodes?.[0]).toHaveProperty('facets')
    }

    const planEvent = events.find((evt) => evt.type === 'plan_generated')
    const planNodes = (planEvent?.payload as any)?.plan?.nodes ?? []
    const executionSummary = planNodes.find((node: any) => node.capabilityId === CONTENT_CAPABILITY_ID)
    expect(executionSummary?.contracts?.outputMode).toBe('json_schema')
    expect(executionSummary?.facets?.output).toEqual(expect.arrayContaining(['copyVariants']))

    expect(persistence.statuses.get(result.runId)).toBe('completed')
    expect(persistence.results.get(result.runId)?.copyVariants).toHaveLength(2)
  })

  it('retries planner when the first draft is rejected and emits plan_rejected', async () => {
    const persistence = new MemoryFlexPersistence()
    const plannerService = createPlannerServiceStub({ firstPlanInvalid: true })
    const { coordinator } = createCoordinator(persistence, { plannerService })
    const events: FlexEvent[] = []

    const result = await coordinator.run(buildEnvelope(), {
      correlationId: 'cid_replan',
      onEvent: async (evt) => {
        events.push(evt)
      }
    })

    expect(result.status).toBe('completed')
    const eventTypes = events.map((evt) => evt.type)
    const firstPlanRequestedIndex = eventTypes.indexOf('plan_requested')
    const planRejectedIndex = eventTypes.indexOf('plan_rejected')
    const secondPlanRequestedIndex = eventTypes.lastIndexOf('plan_requested')
    const planGeneratedIndex = eventTypes.indexOf('plan_generated')

    expect(firstPlanRequestedIndex).toBeGreaterThanOrEqual(0)
    expect(planRejectedIndex).toBeGreaterThan(firstPlanRequestedIndex)
    expect(secondPlanRequestedIndex).toBeGreaterThan(planRejectedIndex)
    expect(planGeneratedIndex).toBeGreaterThan(secondPlanRequestedIndex)

    const rejectedEvent = events[planRejectedIndex]
    expect((rejectedEvent.payload as any)?.diagnostics?.[0]?.code).toBe('CAPABILITY_NOT_REGISTERED')

    expect(persistence.statuses.get(result.runId)).toBe('completed')
  })

  it('emits policy_triggered and plan_updated when mid-run policies demand replanning', async () => {
    const persistence = new MemoryFlexPersistence()
    let callCount = 0
    const graphContexts: Array<PlannerServiceInput['graphContext'] | undefined> = []
    const plannerService: PlannerServiceInterface = {
      async proposePlan({ scenario, graphContext }) {
        graphContexts.push(graphContext)
        callCount += 1
        const baseNodes = [
          {
            stage: 'strategy',
            kind: 'structuring',
            capabilityId: STRATEGY_CAPABILITY_ID,
            inputFacets: ['objectiveBrief', 'audienceProfile', 'toneOfVoice', 'assetBundle'],
            outputFacets: ['writerBrief', 'planKnobs', 'strategicRationale'],
            derived: false
          },
          {
            stage: 'generation',
            kind: 'execution',
            capabilityId: CONTENT_CAPABILITY_ID,
            inputFacets: ['writerBrief', 'planKnobs', 'toneOfVoice', 'audienceProfile'],
            outputFacets: ['copyVariants'],
            derived: scenario !== 'linkedin_post_variants'
          },
          {
            stage: 'qa',
            kind: 'validation',
            capabilityId: QA_CAPABILITY_ID,
            inputFacets: ['copyVariants', 'writerBrief', 'qaRubric'],
            outputFacets: ['qaFindings', 'recommendationSet'],
            derived: true
          }
        ]

        if (callCount >= 2) {
          baseNodes.splice(2, 0, {
            stage: 'normalization',
            kind: 'transformation',
            capabilityId: CONTENT_CAPABILITY_ID,
            inputFacets: ['copyVariants'],
            outputFacets: ['copyVariants'],
            rationale: ['policy_adjustment']
          } as any)
        }

        return {
          nodes: baseNodes,
          metadata: {
            provider: 'planner-stub',
            model: 'stub-1.0',
            attempt: callCount
          }
        }
      }
    }

    const { coordinator } = createCoordinator(persistence, { plannerService })
    const events: FlexEvent[] = []

    const envelope = buildEnvelope({
      policies: {
        replanAfter: [{ stage: 'generation', reason: 'policy_delta' }]
      }
    })

    const result = await coordinator.run(envelope, {
      correlationId: 'cid_policy_trigger',
      onEvent: async (evt) => events.push(evt)
    })

    expect(result.status).toBe('completed')
    const eventTypes = events.map((evt) => evt.type)
    expect(eventTypes).toContain('policy_triggered')
    expect(eventTypes).toContain('plan_updated')
    const policyIndex = eventTypes.indexOf('policy_triggered')
    const updateIndex = eventTypes.indexOf('plan_updated')
    expect(updateIndex).toBeGreaterThan(policyIndex)

    const planUpdatedEvent = events[updateIndex]
    const payload = planUpdatedEvent.payload as any
    expect(payload?.trigger?.reason).toBe('policy_directive')
    expect(Array.isArray(payload?.nodes)).toBe(true)
    expect(payload?.metadata?.plannerPhase).toBe('replan')
    expect(persistence.planVersions.get(result.runId)).toBeGreaterThanOrEqual(2)

    expect(graphContexts.length).toBeGreaterThanOrEqual(2)
    const replanContext = graphContexts[1]
    expect(replanContext).toBeDefined()
    expect(replanContext?.completedNodes?.some((node) => node.capabilityId === CONTENT_CAPABILITY_ID)).toBe(true)
    const copyFacet = replanContext?.facetValues?.find((entry) => entry.facet === 'copyVariants')
    expect(copyFacet).toBeDefined()
    expect(Array.isArray(copyFacet?.value)).toBe(true)
    const firstVariant = Array.isArray(copyFacet?.value) ? (copyFacet?.value as any[])[0] : null
    expect(firstVariant?.headline).toContain('Team Retreat')
  })
  it('resumes awaiting_hitl run using stored run context facets', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator } = createCoordinator(persistence)
    const runId = 'flex_resume_test'
    const facetSnapshot = {
      copyVariants: {
        value: [
          {
            headline: 'Resume Success',
            body: 'Stored facet payload revived after HITL pause to complete the run.',
            callToAction: 'Let us know'
          },
          {
            headline: 'Variant B Returns',
            body: 'Second output variant ensures schema validation passes during the resume flow.',
            callToAction: 'Share feedback'
          }
        ],
        updatedAt: '2025-04-01T12:00:00.000Z',
        provenance: [
          {
            nodeId: 'ContentGeneratorAgent_linkedinVariants_1',
            capabilityId: CONTENT_CAPABILITY_ID,
            timestamp: '2025-04-01T12:00:00.000Z'
          }
        ]
      }
    }

    persistence.runs.set(runId, {
      runId,
      status: 'awaiting_hitl',
      envelope: buildEnvelope(),
      schemaHash: null,
      metadata: null,
      result: null,
      planVersion: 1,
      contextSnapshot: facetSnapshot
    })
    persistence.statuses.set(runId, 'awaiting_hitl')
    persistence.contexts.set(runId, { ...facetSnapshot })
    persistence.nodes.set(`${runId}:ContentGeneratorAgent_linkedinVariants_1`, {
      nodeId: 'ContentGeneratorAgent_linkedinVariants_1',
      capabilityId: CONTENT_CAPABILITY_ID,
      label: 'Copywriter – LinkedIn Variants',
      status: 'completed',
      context: null,
      output: facetSnapshot.copyVariants.value,
      startedAt: new Date(),
      completedAt: new Date()
    })
    persistence.nodes.set(`${runId}:fallback_2`, {
      nodeId: 'fallback_2',
      capabilityId: null,
      label: 'HITL fallback path',
      status: 'awaiting_hitl',
      context: null,
      output: null,
      startedAt: new Date(),
      completedAt: null
    })

    const resumeEnvelope = buildEnvelope({
      constraints: {
        resumeRunId: runId
      }
    })

    const result = await coordinator.run(resumeEnvelope, {
      correlationId: 'cid_resume_hitl',
      onEvent: vi.fn()
    })

    expect(result.status).toBe('completed')
    expect(result.output).toBeTruthy()
    expect(Array.isArray(result.output?.copyVariants)).toBe(true)
    expect(result.output?.copyVariants?.[0]?.headline).toBe('Resume Success')
    expect(persistence.contexts.get(runId)).toBeDefined()
    expect(persistence.results.get(runId)).toEqual(result.output)
  })

  it('emits validation_error and fails when output schema is stricter than stub', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator, runtime } = createCoordinator(persistence)
    const events: FlexEvent[] = []

    const defaultImpl = runtime.runStructured.getMockImplementation()
    runtime.runStructured.mockImplementationOnce(async (schema, messages, options) => {
      return defaultImpl?.(schema, messages, options)
    })
    runtime.runStructured.mockImplementationOnce(async () => ({
      copyVariants: [
        {
          headline: 'Only Variant',
          body: 'Single variant body content that exceeds the minimum length requirement for validation.',
          callToAction: 'Learn more'
        }
      ]
    }))

    const envelope = buildEnvelope({
      inputs: {
        channel: 'linkedin',
        variantCount: 1
      } as any,
      outputContract: {
        mode: 'json_schema',
        schema: {
          type: 'object',
          required: ['variants'],
          properties: {
            variants: {
              type: 'array',
              minItems: 2,
              items: { type: 'object' }
            }
          }
        }
      }
    })

    await expect(
      coordinator.run(envelope, {
        correlationId: 'cid_fail',
        onEvent: async (evt) => events.push(evt)
      })
    ).rejects.toThrow('capability_output validation failed')

    const validationFrames = events.filter((evt) => evt.type === 'validation_error')
    expect(validationFrames).toHaveLength(1)
    const [frame] = validationFrames
    expect((frame.payload as any)?.scope).toBe('capability_output')
    expect(Array.isArray((frame.payload as any)?.errors)).toBe(true)
  })

  it('pauses for HITL when policies require approval', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator, hitlService } = createCoordinator(persistence)
    const events: FlexEvent[] = []

    const envelope = buildEnvelope({
      policies: {
        requiresHitlApproval: true
      }
    })

    const result = await coordinator.run(envelope, {
      correlationId: 'cid_hitl',
      onEvent: async (evt) => events.push(evt)
    })

    expect(result.status).toBe('awaiting_hitl')
    expect(result.output).toBeNull()
    const hitlEvent = events.find((evt) => evt.type === 'hitl_request')
    expect(hitlEvent).toBeTruthy()
    expect((hitlEvent?.payload as any)?.request?.id).toMatch(/^req_/)
    expect(persistence.statuses.get(result.runId)).toBe('awaiting_hitl')
    const awaitingSnapshot = persistence.snapshots.get(result.runId)?.snapshot
    expect(awaitingSnapshot).toBeDefined()
    expect(awaitingSnapshot?.nodes?.some((node: any) => node.status === 'awaiting_hitl')).toBe(true)
    expect(awaitingSnapshot?.pendingState?.completedNodeIds).toBeDefined()
    expect(
      awaitingSnapshot?.nodes?.some(
        (node: any) => Array.isArray(node.facets?.output) && node.facets.output.includes('copyVariants')
      )
    ).toBe(true)

    // Simulate approval and resume flow
    hitlService.state = {
      requests: hitlService.state.requests.map((req) => ({ ...req, status: req.id === hitlService.state.pendingRequestId ? 'resolved' : req.status })),
      responses: [],
      pendingRequestId: null,
      deniedCount: 0
    }

    const resumeEvents: FlexEvent[] = []
    const resumeEnvelope = buildEnvelope({ policies: { requiresHitlApproval: false } })
    resumeEnvelope.constraints = {
      ...(resumeEnvelope.constraints ?? {}),
      resumeRunId: result.runId,
      threadId: hitlService.state.requests[0]?.threadId ?? 'thread_resume'
    }

    const resumeResult = await coordinator.run(resumeEnvelope, {
      correlationId: 'cid_resume',
      onEvent: async (evt) => resumeEvents.push(evt)
    })

    expect(resumeResult.status).toBe('completed')
    expect(resumeResult.output?.copyVariants).toHaveLength(2)
    expect(resumeEvents.map((evt) => evt.type)).toContain('plan_generated')
    const resumePlanEvent = resumeEvents.find((evt) => evt.type === 'plan_generated')
    const resumeNodes = (resumePlanEvent?.payload as any)?.plan?.nodes ?? []
    const resumeExecutionSummary = resumeNodes.find((node: any) => node.capabilityId === CONTENT_CAPABILITY_ID)
    if (resumeExecutionSummary?.contracts) {
      expect(resumeExecutionSummary.contracts.outputMode).toBe('json_schema')
    }
    expect(resumeEvents.some((evt) => evt.type === 'complete')).toBe(true)
    expect(persistence.statuses.get(resumeResult.runId)).toBe('completed')
    const resumeOutputRecord = persistence.outputs.get(resumeResult.runId)
    expect(resumeOutputRecord?.options?.status).toBe('completed')
    expect(resumeOutputRecord?.options?.facets).toBeDefined()
    const resumeFacetSnapshot = resumeOutputRecord?.options?.facets?.copyVariants
    expect(resumeFacetSnapshot?.provenance?.length ?? 0).toBeGreaterThan(0)
    const resumeSnapshot = resumeOutputRecord?.options?.snapshot
    if (resumeSnapshot) {
      expect(resumeSnapshot.nodes.some((node: any) => node.status === 'completed')).toBe(true)
      expect(resumeSnapshot.nodes.some((node: any) => node.status === 'awaiting_hitl')).toBe(false)
      expect(
        resumeSnapshot.nodes.some(
          (node: any) => Array.isArray(node.facets?.output) && node.facets.output.includes('copyVariants')
        )
      ).toBe(true)
      expect(
        resumeSnapshot.nodes.every(
          (node: any) =>
            node.contracts?.output &&
            typeof node.contracts.output === 'object' &&
            Object.keys(node.contracts.output).length > 0
        )
      ).toBe(true)
    }
  })

  it('starts a fresh run when threadId matches a completed run', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator } = createCoordinator(persistence)

    const firstEnvelope = buildEnvelope()
    firstEnvelope.metadata = { ...(firstEnvelope.metadata ?? {}), clientId: 'awesomeposter-marketing', threadId: 'thread_shared' }

    const firstEvents: FlexEvent[] = []
    const firstResult = await coordinator.run(firstEnvelope, {
      correlationId: 'cid_thread_fresh_1',
      onEvent: async (evt) => firstEvents.push(evt)
    })

    expect(firstResult.status).toBe('completed')
    const storedFirst = persistence.runs.get(firstResult.runId)
    expect(storedFirst?.envelope.objective).toBe(firstEnvelope.objective)

    const secondEnvelope = buildEnvelope({
      objective: 'Create refreshed LinkedIn variants',
      inputs: {
        channel: 'linkedin',
        variantCount: 3
      } as any
    })
    secondEnvelope.metadata = { ...(secondEnvelope.metadata ?? {}), clientId: 'awesomeposter-marketing', threadId: 'thread_shared' }

    const secondEvents: FlexEvent[] = []
    const secondResult = await coordinator.run(secondEnvelope, {
      correlationId: 'cid_thread_fresh_2',
      onEvent: async (evt) => secondEvents.push(evt)
    })

    expect(secondResult.status).toBe('completed')
    expect(secondResult.runId).not.toBe(firstResult.runId)

    const storedSecond = persistence.runs.get(secondResult.runId)
    expect(storedSecond?.envelope.objective).toBe('Create refreshed LinkedIn variants')
    expect((storedSecond?.envelope.inputs as Record<string, unknown> | undefined)?.variantCount).toBe(3)
  })
})
