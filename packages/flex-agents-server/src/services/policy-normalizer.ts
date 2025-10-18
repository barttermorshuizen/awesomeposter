import type { TaskEnvelope } from '@awesomeposter/shared'
import type { FlexPlanNode } from './flex-planner'
import type { ReplanTrigger } from './flex-execution-engine'

export type ReplanDirective = {
  match: 'capability' | 'stage' | 'node' | 'kind'
  value: string
  reason?: string
}

export type NormalizedPolicies = {
  raw: Record<string, unknown>
  replanDirectives: ReplanDirective[]
}

function coerceArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null) return []
  return [value]
}

function toDirective(entry: unknown): ReplanDirective | null {
  if (!entry || (typeof entry !== 'object' && typeof entry !== 'string')) {
    return null
  }

  if (typeof entry === 'string') {
    return { match: 'stage', value: entry }
  }

  const record = entry as Record<string, unknown>

  if (typeof record.capabilityId === 'string') {
    return {
      match: 'capability',
      value: record.capabilityId,
      reason: typeof record.reason === 'string' ? record.reason : undefined
    }
  }

  if (typeof record.nodeId === 'string') {
    return {
      match: 'node',
      value: record.nodeId,
      reason: typeof record.reason === 'string' ? record.reason : undefined
    }
  }

  if (typeof record.stage === 'string') {
    return {
      match: 'stage',
      value: record.stage,
      reason: typeof record.reason === 'string' ? record.reason : undefined
    }
  }

  if (typeof record.kind === 'string') {
    return {
      match: 'kind',
      value: record.kind,
      reason: typeof record.reason === 'string' ? record.reason : undefined
    }
  }

  return null
}

export class PolicyNormalizer {
  normalize(envelope: TaskEnvelope): NormalizedPolicies {
    const raw = (envelope.policies ?? {}) as Record<string, unknown>
    const directives: ReplanDirective[] = []

    const buckets = [
      raw.replanAfter,
      (raw.replan as Record<string, unknown> | undefined)?.after,
      raw.triggerReplanAfter,
      raw.policyTriggers
    ]

    for (const bucket of buckets) {
      for (const item of coerceArray(bucket)) {
        const directive = toDirective(item)
        if (directive) directives.push(directive)
      }
    }

    return {
      raw,
      replanDirectives: directives
    }
  }

  shouldTriggerReplan(policies: NormalizedPolicies, node: FlexPlanNode): ReplanTrigger | null {
    for (const directive of policies.replanDirectives) {
      if (directive.match === 'capability' && directive.value === node.capabilityId) {
        return this.buildTrigger('policy_directive', directive, node)
      }
      if (directive.match === 'node' && directive.value === node.id) {
        return this.buildTrigger('policy_directive', directive, node)
      }
      if (directive.match === 'stage') {
        const stage = typeof node.metadata?.plannerStage === 'string' ? node.metadata.plannerStage : null
        if (stage && stage === directive.value) {
          return this.buildTrigger('policy_directive', directive, node)
        }
      }
      if (directive.match === 'kind' && directive.value === (node.kind ?? 'execution')) {
        return this.buildTrigger('policy_directive', directive, node)
      }
    }
    return null
  }

  private buildTrigger(reason: string, directive: ReplanDirective, node: FlexPlanNode): ReplanTrigger {
    return {
      reason,
      details: {
        directive: {
          match: directive.match,
          value: directive.value,
          reason: directive.reason
        },
        node: {
          id: node.id,
          capabilityId: node.capabilityId,
          stage: typeof node.metadata?.plannerStage === 'string' ? node.metadata.plannerStage : undefined
        }
      }
    }
  }
}

