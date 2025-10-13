import type {
  TaskEnvelope,
  ContextBundle,
  NodeContract,
  OutputContract,
  CapabilityRecord
} from '@awesomeposter/shared'
import { getFlexCapabilityRegistryService, type FlexCapabilityRegistryService } from './flex-capability-registry'
import { getLogger } from './logger'
import { CONTENT_CAPABILITY_ID } from '../agents/content-generator'

export type FlexPlanEdge = { from: string; to: string }

export type FlexPlanNode = {
  id: string
  capabilityId: string
  label: string
  bundle: ContextBundle
}

export type FlexPlan = {
  runId: string
  version: number
  createdAt: string
  nodes: FlexPlanNode[]
  edges: FlexPlanEdge[]
  metadata: Record<string, unknown>
}

export class UnsupportedObjectiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsupportedObjectiveError'
  }
}

type PlannerOptions = {
  now?: () => Date
}

export class FlexPlanner {
  private readonly now: () => Date

  constructor(
    private readonly capabilityRegistry: FlexCapabilityRegistryService = getFlexCapabilityRegistryService(),
    options?: PlannerOptions
  ) {
    this.now = options?.now ?? (() => new Date())
  }

  async buildPlan(runId: string, envelope: TaskEnvelope): Promise<FlexPlan> {
    const lowerObjective = (envelope.objective || '').toLowerCase()
    const inputs = (envelope.inputs ?? {}) as Record<string, unknown>
    const policies = (envelope.policies ?? {}) as Record<string, unknown>

    const channel = String(inputs.channel ?? inputs.platform ?? '').toLowerCase()
    const variantCount = this.normalizeVariantCount(inputs.variantCount ?? policies.variantCount ?? 1)
    const contextBundles = Array.isArray(inputs.contextBundles) ? inputs.contextBundles : []

    const scenario = this.detectScenario({ lowerObjective, channel })
    if (!scenario) {
      throw new UnsupportedObjectiveError('Objective not supported by planner skeleton')
    }

    const capability = await this.selectCapabilityForScenario(scenario)
    const capabilityId = capability.capabilityId

    const nodeId = `${capabilityId.replace(/\W+/g, '_')}_1`
    const contract: NodeContract = {
      output: this.buildNodeContract(envelope.outputContract),
      expectations: [
        `Produce ${variantCount} LinkedIn post variants tailored for developer experience audiences.`,
        'Reflect the supplied company profile and objective in each variant.'
      ],
      maxAttempts: 2,
      fallback: policies.requiresHitlApproval ? 'hitl' : 'retry'
    }

    const bundle: ContextBundle = {
      runId,
      nodeId,
      objective: envelope.objective,
      instructions: Array.isArray(envelope.specialInstructions) ? envelope.specialInstructions.slice(0, 8) : undefined,
      inputs: {
        ...inputs,
        variantCount,
        contextBundles
      },
      policies,
      contract,
      priorOutputs: undefined,
      artifacts: undefined
    }

    const plan: FlexPlan = {
      runId,
      version: 1,
      createdAt: this.now().toISOString(),
      nodes: [
        {
          id: nodeId,
          capabilityId,
          label: 'Generate LinkedIn post variants',
          bundle
        }
      ],
      edges: [],
      metadata: {
        scenario,
        variantCount
      }
    }

    return plan
  }

  private detectScenario(input: { lowerObjective: string; channel: string }) {
    if (input.channel.includes('linkedin')) return 'linkedin_post_variants'
    if (input.lowerObjective.includes('linkedin') && input.lowerObjective.includes('variant')) {
      return 'linkedin_post_variants'
    }
    return null
  }

  private normalizeVariantCount(raw: unknown): number {
    const num = Number(raw)
    if (!Number.isFinite(num) || num < 1) return 1
    if (num > 5) return 5
    return Math.floor(num)
  }

  private buildNodeContract(contract: OutputContract): OutputContract {
    if (contract.mode === 'json_schema') {
      return contract
    }
    return contract
  }

  private async selectCapabilityForScenario(scenario: string): Promise<CapabilityRecord> {
    try {
      const active = await this.capabilityRegistry.listActive()
      const matched = active.find((entry) => {
        const meta = (entry.metadata ?? {}) as Record<string, unknown>
        const scenarios = Array.isArray(meta.scenarios) ? (meta.scenarios as unknown[]) : []
        return scenarios.some((value) => typeof value === 'string' && value === scenario)
      })
      if (matched) {
        return matched
      }
    } catch (error) {
      try {
        getLogger().warn('flex_capability_lookup_failed', {
          scenario,
          error: error instanceof Error ? error.message : String(error)
        })
      } catch {}
    }

    const fallback = await this.capabilityRegistry.getCapabilityById(CONTENT_CAPABILITY_ID)
    if (fallback && fallback.status === 'active') {
      return fallback
    }

    throw new UnsupportedObjectiveError(`No active capability available for scenario "${scenario}"`)
  }
}
