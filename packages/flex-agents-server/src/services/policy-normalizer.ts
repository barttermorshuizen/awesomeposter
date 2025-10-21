import {
  parseTaskPolicies,
  type PlannerPolicy,
  type RuntimePolicy,
  type TaskEnvelope,
  type TaskPolicies
} from '@awesomeposter/shared'
import type { FlexPlanNode } from './flex-planner'
import type { ReplanTrigger } from './flex-execution-engine'
import { ZodError, type ZodIssue } from 'zod'

export class PolicyValidationError extends Error {
  constructor(message: string, public readonly issues: ZodIssue[]) {
    super(message)
    this.name = 'PolicyValidationError'
  }
}

export type NormalizedPolicies = {
  canonical: TaskPolicies
  planner: PlannerPolicy | undefined
  runtime: RuntimePolicy[]
  legacyNotes: string[]
  legacyFields: string[]
}

type LegacyDirective =
  | { kind: 'capability'; value: string; rationale?: string }
  | { kind: 'node'; value: string; rationale?: string }
  | { kind: 'kind'; value: string; rationale?: string }
  | { kind: 'stage'; value: string; rationale?: string }

type NodeCompleteTrigger = Extract<RuntimePolicy['trigger'], { kind: 'onNodeComplete' }>

export type RuntimePolicyEffect =
  | { kind: 'replan'; trigger: ReplanTrigger }
  | { kind: 'action'; policy: RuntimePolicy }

export class PolicyNormalizer {
  normalize(envelope: TaskEnvelope): NormalizedPolicies {
    const { base, extras } = this.extractCanonicalSections(envelope.policies)

    let canonical: TaskPolicies
    try {
      canonical = parseTaskPolicies(base)
    } catch (error) {
      if (error instanceof ZodError) {
        throw new PolicyValidationError('TaskEnvelope policies failed validation', error.issues)
      }
      throw error
    }

    const legacyNotes: string[] = []
    const legacyFields = new Set<string>()

    const plannerFromLegacy = this.derivePlannerPolicy(extras)
    if (plannerFromLegacy) {
      canonical = {
        ...canonical,
        planner: this.mergePlannerPolicies(canonical.planner, plannerFromLegacy.policy)
      }
      legacyNotes.push(...plannerFromLegacy.notes)
      plannerFromLegacy.fields.forEach((field) => legacyFields.add(field))
    }

    const legacyRuntime = this.deriveRuntimePolicies(extras)
    if (legacyRuntime.policies.length) {
      canonical = {
        ...canonical,
        runtime: [...canonical.runtime, ...legacyRuntime.policies]
      }
      legacyNotes.push(...legacyRuntime.notes)
      legacyRuntime.fields.forEach((field) => legacyFields.add(field))
    }

    canonical = parseTaskPolicies(canonical)

    return {
      canonical,
      planner: canonical.planner,
      runtime: canonical.runtime,
      legacyNotes,
      legacyFields: Array.from(legacyFields)
    }
  }

  evaluateRuntimeEffect(policies: NormalizedPolicies, node: FlexPlanNode): RuntimePolicyEffect | null {
    for (const policy of policies.runtime) {
      if (!policy.enabled) continue
      const trigger = policy.trigger
      if (trigger.kind !== 'onNodeComplete') continue
      if (!this.matchesNodeSelector(trigger.selector, node)) continue
      if (trigger.condition && !this.evaluateCondition(trigger.condition, node)) {
        continue
      }
      if (policy.action.type === 'replan') {
        return {
          kind: 'replan',
          trigger: this.buildReplanTrigger('policy_runtime_replan', policy, node)
        }
      }
      return {
        kind: 'action',
        policy
      }
    }
    return null
  }

  private matchesNodeSelector(selector: NodeCompleteTrigger['selector'], node: FlexPlanNode): boolean {
    if (!selector) return true

    if (selector.capabilityId && selector.capabilityId !== node.capabilityId) {
      return false
    }

    if (selector.nodeId && selector.nodeId !== node.id) {
      return false
    }

    if (selector.kind && selector.kind !== (node.kind ?? 'execution')) {
      return false
    }

    return true
  }

  private buildReplanTrigger(reason: string, policy: RuntimePolicy, node: FlexPlanNode): ReplanTrigger {
    return {
      reason,
      details: {
        policyId: policy.id,
        action: policy.action.type,
        node: {
          id: node.id,
          capabilityId: node.capabilityId,
          stage: typeof node.metadata?.plannerStage === 'string' ? node.metadata.plannerStage : undefined
        }
      }
    }
  }

  private extractCanonicalSections(value: TaskEnvelope['policies']): {
    base: Record<string, unknown>
    extras: Record<string, unknown>
  } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { base: {}, extras: {} }
    }

    const record = value as Record<string, unknown>
    const { planner, runtime, ...extras } = record
    const base: Record<string, unknown> = {}
    if (planner !== undefined) base.planner = planner
    if (runtime !== undefined) base.runtime = runtime
    return { base, extras }
  }

  private derivePlannerPolicy(extras: Record<string, unknown>):
    | { policy: PlannerPolicy; notes: string[]; fields: string[] }
    | null {
    const notes: string[] = []
    const fields: string[] = []
    const topology: PlannerPolicy['topology'] = {}

    if (typeof extras.variantCount === 'number') {
      topology.variantCount = extras.variantCount
      notes.push('Mapped legacy `variantCount` to planner.topology.variantCount.')
      fields.push('variantCount')
    }

    const hasTopology = Object.keys(topology).length > 0
    if (!hasTopology) {
      return null
    }

    return {
      policy: {
        topology
      },
      notes,
      fields
    }
  }

  private deriveRuntimePolicies(extras: Record<string, unknown>): {
    policies: RuntimePolicy[]
    notes: string[]
    fields: string[]
  } {
    const directives = this.collectLegacyDirectives(extras)
    if (!directives.length) {
      return { policies: [], notes: [], fields: [] }
    }

    const policies = directives.map((directive, index) => this.toRuntimePolicy(directive, index))
    const fields: string[] = []
    if (extras.replanAfter !== undefined) fields.push('replanAfter')
    if (extras.replan && typeof extras.replan === 'object' && extras.replan !== null && 'after' in (extras.replan as Record<string, unknown>)) {
      fields.push('replan.after')
    }
    if (extras.triggerReplanAfter !== undefined) fields.push('triggerReplanAfter')
    if (extras.policyTriggers !== undefined) fields.push('policyTriggers')
    return {
      policies,
      notes: ['Converted legacy replan directives into runtime policies (TODO: align action naming in Stories 8.23/8.24).'],
      fields
    }
  }

  private collectLegacyDirectives(extras: Record<string, unknown>): LegacyDirective[] {
    const candidates: unknown[] = []
    candidates.push(extras.replanAfter)

    if (extras.replan && typeof extras.replan === 'object' && extras.replan !== null) {
      candidates.push((extras.replan as Record<string, unknown>).after)
    }

    candidates.push(extras.triggerReplanAfter, extras.policyTriggers)

    const directives: LegacyDirective[] = []
    for (const bucket of candidates) {
      for (const entry of this.coerceArray(bucket)) {
        const directive = this.toLegacyDirective(entry)
        if (directive) {
          directives.push(directive)
        }
      }
    }
    return directives
  }

  private toLegacyDirective(entry: unknown): LegacyDirective | null {
    if (!entry || (typeof entry !== 'object' && typeof entry !== 'string')) {
      return null
    }

    if (typeof entry === 'string') {
      return { kind: 'stage', value: entry }
    }

    const record = entry as Record<string, unknown>

    if (typeof record.capabilityId === 'string') {
      return {
        kind: 'capability',
        value: record.capabilityId,
        rationale: typeof record.reason === 'string' ? record.reason : undefined
      }
    }

    if (typeof record.nodeId === 'string') {
      return {
        kind: 'node',
        value: record.nodeId,
        rationale: typeof record.reason === 'string' ? record.reason : undefined
      }
    }

    if (typeof record.stage === 'string') {
      return {
        kind: 'stage',
        value: record.stage,
        rationale: typeof record.reason === 'string' ? record.reason : undefined
      }
    }

    if (typeof record.kind === 'string') {
      return {
        kind: 'kind',
        value: record.kind,
        rationale: typeof record.reason === 'string' ? record.reason : undefined
      }
    }

    return null
  }

  private toRuntimePolicy(directive: LegacyDirective, index: number): RuntimePolicy {
    const baseId = `legacy_${directive.kind}_${directive.value || index + 1}`
    const id = baseId.replace(/[^a-zA-Z0-9_]+/g, '_')

    const selector =
      directive.kind === 'capability'
        ? { capabilityId: directive.value }
        : directive.kind === 'node'
        ? { nodeId: directive.value }
        : directive.kind === 'kind'
        ? { kind: directive.value }
        : undefined

    const condition =
      directive.kind === 'stage'
        ? {
            '==': [{ var: 'metadata.plannerStage' }, directive.value]
          }
        : undefined

    return {
      id,
      enabled: true,
      trigger: {
        kind: 'onNodeComplete',
        selector,
        condition
      },
      action: {
        type: 'replan',
        rationale: directive.rationale
      }
    }
  }

  private mergePlannerPolicies(current: PlannerPolicy | undefined, incoming: PlannerPolicy): PlannerPolicy {
    if (!current) return incoming
    return {
      ...current,
      topology: {
        ...current.topology,
        ...incoming.topology
      },
      selection: {
        ...current.selection,
        ...incoming.selection
      },
      optimisation: {
        ...current.optimisation,
        ...incoming.optimisation
      },
      directives: incoming.directives
        ? {
            ...(current.directives ?? {}),
            ...incoming.directives
          }
        : current.directives
    }
  }

  private coerceArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value
    if (value === undefined || value === null) return []
    return [value]
  }

  private evaluateCondition(condition: Record<string, unknown>, node: FlexPlanNode): boolean {
    if (!condition || typeof condition !== 'object') return false
    if ('==' in condition) {
      const comparator = (condition as Record<string, unknown>)['==']
      if (Array.isArray(comparator) && comparator.length === 2) {
        const left = this.resolveConditionTerm(comparator[0], node)
        const right = this.resolveConditionTerm(comparator[1], node)
        return left === right
      }
    }
    return false
  }

  private resolveConditionTerm(term: unknown, node: FlexPlanNode): unknown {
    if (term && typeof term === 'object' && !Array.isArray(term)) {
      const record = term as Record<string, unknown>
      if (typeof record.var === 'string') {
        if (record.var === 'metadata.plannerStage') {
          const stage = node.metadata?.plannerStage
          return typeof stage === 'string' ? stage : undefined
        }
      }
    }
    return term
  }
}
