import {
  conditionVariableCatalog,
  evaluateCondition as evaluateJsonLogicCondition,
  parseDsl,
  parseTaskPolicies,
  type ConditionDslError,
  type ConditionDslWarning,
  type ConditionVariableCatalog,
  type JsonLogicExpression,
  type PlannerPolicy,
  type RuntimePolicy,
  type RuntimePolicyCondition,
  type TaskEnvelope,
  type TaskPolicies
} from '@awesomeposter/shared'
import { getLogger } from './logger'
import type { FlexPlanNode } from './flex-planner'
import type { ReplanTrigger } from './flex-execution-engine'
import { ZodError, type ZodIssue } from 'zod'

export class PolicyValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: ZodIssue[] = [],
    public readonly dslErrors: ConditionDslError[] = []
  ) {
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
  constructor(private readonly conditionCatalog: ConditionVariableCatalog = conditionVariableCatalog) {}
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
    const normalizedRuntime = canonical.runtime.map((policy) => this.normalizeRuntimePolicy(policy))
    canonical = {
      ...canonical,
      runtime: normalizedRuntime
    }

    return {
      canonical,
      planner: canonical.planner,
      runtime: normalizedRuntime,
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

  evaluateRunStartEffect(policies: NormalizedPolicies): RuntimePolicyEffect | null {
    for (const policy of policies.runtime) {
      if (!policy.enabled) continue
      if (policy.trigger.kind !== 'onStart') continue
      if (policy.action.type === 'replan') {
        return {
          kind: 'replan',
          trigger: this.buildReplanTrigger('policy_runtime_replan', policy)
        }
      }
      return {
        kind: 'action',
        policy
      }
    }
    return null
  }

  private normalizeRuntimePolicy(policy: RuntimePolicy): RuntimePolicy {
    const trigger = policy.trigger
    if (trigger.kind !== 'onNodeComplete' && trigger.kind !== 'onValidationFail') {
      return policy
    }

    const normalizedCondition = this.normalizeRuntimeCondition(
      trigger.condition as RuntimePolicyCondition | undefined
    )
    if (normalizedCondition === trigger.condition) {
      return policy
    }

    return {
      ...policy,
      trigger: {
        ...trigger,
        condition: normalizedCondition
      }
    }
  }

  private normalizeRuntimeCondition(
    condition: RuntimePolicyCondition | undefined
  ): RuntimePolicyCondition | undefined {
    if (condition === undefined || condition === null) {
      return undefined
    }

    const dslExpression = this.readDslString(condition)
    if (dslExpression) {
      const result = parseDsl(dslExpression, this.conditionCatalog)
      if (!result.ok) {
        throw new PolicyValidationError('Runtime policy DSL failed validation', [], [...result.errors])
      }

      const warnings = result.warnings.length
        ? result.warnings.map((warning) => ({ ...warning }))
        : undefined
      const variables = result.variables.length ? result.variables.map((entry) => entry.path) : undefined

      return {
        jsonLogic: result.jsonLogic,
        dsl: dslExpression,
        canonicalDsl: result.canonical,
        warnings,
        variables
      }
    }

    if (this.hasJsonLogicWrapper(condition)) {
      const jsonLogic = (condition as { jsonLogic: JsonLogicExpression | undefined }).jsonLogic
      if (jsonLogic === undefined) {
        throw new PolicyValidationError('Runtime policy condition is missing jsonLogic payload')
      }

      const canonicalDsl = this.readCanonicalDsl(condition)
      const warnings = this.readWarnings(condition)
      const variables = this.readVariables(condition)
      const existingDsl = this.readDslString(condition)

      return {
        jsonLogic,
        ...(existingDsl ? { dsl: existingDsl } : {}),
        ...(canonicalDsl ? { canonicalDsl } : {}),
        ...(warnings.length ? { warnings } : {}),
        ...(variables.length ? { variables } : {})
      }
    }

    return condition as JsonLogicExpression
  }

  private extractJsonLogic(condition: RuntimePolicyCondition | undefined): JsonLogicExpression | null {
    if (condition === undefined || condition === null) {
      return null
    }
    if (this.hasJsonLogicWrapper(condition)) {
      const wrapped = (condition as { jsonLogic: JsonLogicExpression | undefined }).jsonLogic
      return wrapped === undefined ? null : wrapped
    }
    return condition as JsonLogicExpression
  }

  private hasJsonLogicWrapper(value: unknown): value is { jsonLogic: JsonLogicExpression | undefined } {
    return this.isRecord(value) && Object.prototype.hasOwnProperty.call(value, 'jsonLogic')
  }

  private readDslString(value: unknown): string | undefined {
    if (!this.isRecord(value) || typeof value.dsl !== 'string') {
      return undefined
    }
    const trimmed = value.dsl.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  private readCanonicalDsl(value: unknown): string | undefined {
    if (!this.isRecord(value) || typeof value.canonicalDsl !== 'string') {
      return undefined
    }
    const trimmed = value.canonicalDsl.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  private readWarnings(value: unknown): ConditionDslWarning[] {
    if (!this.isRecord(value) || !Array.isArray(value.warnings)) {
      return []
    }
    return value.warnings
      .filter((warning): warning is ConditionDslWarning => Boolean(warning))
      .map((warning) => ({ ...warning }))
  }

  private readVariables(value: unknown): string[] {
    if (!this.isRecord(value) || !Array.isArray(value.variables)) {
      return []
    }
    return value.variables
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0)
  }

  private isRecord(value: unknown): value is Record<string, any> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
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

  private buildReplanTrigger(reason: string, policy: RuntimePolicy, node?: FlexPlanNode): ReplanTrigger {
    const details: Record<string, unknown> = {
      policyId: policy.id,
      action: policy.action.type,
      triggerKind: policy.trigger.kind
    }
    if (node) {
      details.node = {
        id: node.id,
        capabilityId: node.capabilityId,
        stage: typeof node.metadata?.plannerStage === 'string' ? node.metadata.plannerStage : undefined
      }
    } else {
      details.phase = 'startup'
    }
    return {
      reason,
      details
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

  private evaluateCondition(condition: RuntimePolicyCondition | undefined, node: FlexPlanNode): boolean {
    const jsonLogic = this.extractJsonLogic(condition)
    if (jsonLogic == null) return false
    const metadata = node.metadata && typeof node.metadata === 'object' ? (node.metadata as Record<string, unknown>) : null
    const snapshot = metadata && typeof metadata.runContextSnapshot === 'object'
      ? (metadata.runContextSnapshot as Record<string, unknown> | undefined)
      : undefined
    const facets = snapshot && typeof snapshot === 'object' && snapshot && 'facets' in snapshot
      ? (snapshot.facets as unknown)
      : null

    const evaluation = evaluateJsonLogicCondition(jsonLogic, node)
    if (!evaluation.ok) {
      try {
        getLogger().info('flex_runtime_policy_condition_error', {
          nodeId: node.id,
          capabilityId: node.capabilityId,
          error: evaluation.error,
          conditionDsl: this.readDslString(condition),
          conditionJsonLogic: jsonLogic,
          condition,
          runContextFacets: facets ?? null
        })
      } catch {}
      return false
    }
    try {
      getLogger().info('flex_runtime_policy_condition_eval', {
        nodeId: node.id,
        capabilityId: node.capabilityId,
        result: evaluation.result,
        conditionDsl: this.readDslString(condition),
        conditionJsonLogic: jsonLogic,
        condition,
        runContextFacets: facets ?? null
      })
    } catch {}
    return evaluation.result
  }
}
