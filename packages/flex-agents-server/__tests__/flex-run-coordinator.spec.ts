// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import type { FlexEvent, TaskEnvelope, HitlRunState, HitlRequestRecord, HitlRequestPayload } from '@awesomeposter/shared'
import { FlexRunCoordinator } from '../src/services/flex-run-coordinator'
import { FlexExecutionEngine } from '../src/services/flex-execution-engine'
import { FlexPlanner } from '../src/services/flex-planner'
import { getHitlContext } from '../src/services/hitl-context'
import { CONTENT_CAPABILITY_ID } from '../src/agents/content-generator'

class MemoryFlexPersistence {
  runs = new Map<string, any>()
  statuses = new Map<string, string>()
  nodes = new Map<string, any>()
  results = new Map<string, Record<string, unknown>>()
  planVersions = new Map<string, number>()
  pendingResults = new Map<string, Record<string, unknown>>()

  async createOrUpdateRun(record: any) {
    this.runs.set(record.runId, { ...record })
    this.statuses.set(record.runId, record.status)
  }

  async updateStatus(runId: string, status: any) {
    this.statuses.set(runId, status)
    const run = this.runs.get(runId)
    if (run) run.status = status
  }

  async savePlanSnapshot(runId: string, version: number, nodes: any[]) {
    this.planVersions.set(runId, version)
    for (const node of nodes) {
      this.nodes.set(`${runId}:${node.nodeId}`, { ...node })
    }
    const run = this.runs.get(runId)
    if (run) run.planVersion = version
  }

  async markNode(runId: string, nodeId: string, updates: any) {
    const key = `${runId}:${nodeId}`
    const current = this.nodes.get(key) || { nodeId }
    this.nodes.set(key, { ...current, ...updates })
  }

  async recordResult(runId: string, result: Record<string, unknown>) {
    this.results.set(runId, result)
    const run = this.runs.get(runId)
    if (run) run.result = result
    this.statuses.set(runId, 'completed')
    if (run) run.status = 'completed'
  }

  async ensure() {}

  async recordPendingResult(runId: string, result: Record<string, unknown>) {
    this.pendingResults.set(runId, result)
    const run = this.runs.get(runId)
    if (run) run.result = result
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
        planVersion: run.planVersion ?? 1
      },
      nodes
    }
  }

  async findFlexRunByThreadId(threadId: string) {
    const entry = Array.from(this.runs.values()).find((run) => run.threadId === threadId)
    if (!entry) return null
    return this.loadFlexRun(entry.runId)
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

function createCoordinator(persistence: MemoryFlexPersistence) {
  const capabilityRecord = {
    capabilityId: CONTENT_CAPABILITY_ID,
    status: 'active' as const,
    version: '1.0.0',
    displayName: 'LinkedIn Variants',
    summary: 'Generates LinkedIn post variants from envelope context.',
    defaultContract: {
      mode: 'json_schema' as const,
      schema: {
        type: 'object',
        required: ['variants'],
        properties: {
          variants: {
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
    metadata: { scenarios: ['linkedin_post_variants'] }
  }

  const registry = {
    async listActive() {
      return [capabilityRecord]
    },
    async getCapabilityById(id: string) {
      if (id === capabilityRecord.capabilityId) {
        return capabilityRecord
      }
      return undefined
    }
  }

  const planner = new FlexPlanner(registry as any, { now: () => new Date('2025-04-01T12:00:00.000Z') })

  const runtime = {
    runStructured: vi.fn(async () => ({
      variants: [
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
    }))
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
    capability: capabilityRecord
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
        required: ['variants'],
        properties: {
          variants: {
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
    const { coordinator } = createCoordinator(persistence)
    const events: FlexEvent[] = []

    const result = await coordinator.run(buildEnvelope(), {
      correlationId: 'cid_test',
      onEvent: async (evt) => {
        events.push(evt)
      }
    })

    expect(result.runId).toMatch(/^flex_/)
    expect(result.status).toBe('completed')
    expect(result.output?.variants).toHaveLength(2)
    expect(events.map((e) => e.type)).toContain('plan_generated')
    expect(events.map((e) => e.type)).toContain('node_start')
    expect(events.map((e) => e.type)).toContain('node_complete')
    expect(events.map((e) => e.type)).toContain('complete')
    expect(persistence.statuses.get(result.runId)).toBe('completed')
    expect(persistence.results.get(result.runId)?.variants).toHaveLength(2)
  })

  it('emits validation_error and fails when output schema is stricter than stub', async () => {
    const persistence = new MemoryFlexPersistence()
    const { coordinator, runtime } = createCoordinator(persistence)
    const events: FlexEvent[] = []

    runtime.runStructured.mockResolvedValueOnce({
      variants: [
        {
          headline: 'Only Variant',
          body: 'Single variant body content that exceeds the minimum length requirement for validation.',
          callToAction: 'Learn more'
        }
      ]
    })

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
    expect(resumeResult.output?.variants).toHaveLength(2)
    expect(resumeEvents.map((evt) => evt.type)).toContain('plan_generated')
    expect(resumeEvents.some((evt) => evt.type === 'complete')).toBe(true)
    expect(persistence.statuses.get(resumeResult.runId)).toBe('completed')
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
