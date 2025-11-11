import { z } from 'zod'

import {
  normalizeConditionInput,
  type ConditionValidationInput,
  type ConditionValidationResult,
  ConditionDslValidationError
} from '../condition-dsl/validation.js'
import { type ConditionDslWarning, type JsonLogicExpression } from '../condition-dsl/types.js'
import { ConditionDslWarningSchema } from './policies.js'

export const RoutingConditionSchema = z.object({
  dsl: z.string().min(1),
  canonicalDsl: z.string().nullable(),
  jsonLogic: z.unknown(),
  warnings: z.array(ConditionDslWarningSchema).default([]),
  variables: z.array(z.string().min(1)).default([])
})
export type RoutingCondition = z.infer<typeof RoutingConditionSchema>

export const RoutingEdgeSchema = z.object({
  to: z.string().min(1),
  condition: RoutingConditionSchema,
  label: z.string().optional(),
  metadata: z.record(z.unknown()).optional()
})
export type RoutingEdge = z.infer<typeof RoutingEdgeSchema>

export const ConditionalRoutingNodeSchema = z.object({
  routes: z.array(RoutingEdgeSchema).nonempty(),
  elseTo: z.string().min(1).optional(),
  metadata: z.record(z.unknown()).optional()
})
export type ConditionalRoutingNode = z.infer<typeof ConditionalRoutingNodeSchema>

export const RoutingEvaluationTraceSchema = z.object({
  to: z.string().min(1),
  label: z.string().optional(),
  matched: z.boolean().optional(),
  error: z.string().optional(),
  dsl: z.string().optional(),
  canonicalDsl: z.string().nullable().optional(),
  resolvedVariables: z.record(z.unknown()).optional()
})
export type RoutingEvaluationTrace = z.infer<typeof RoutingEvaluationTraceSchema>

export const RoutingEvaluationResultSchema = z.object({
  nodeId: z.string().min(1),
  evaluatedAt: z.string().min(1),
  selectedTarget: z.string().min(1).optional(),
  elseTarget: z.string().min(1).optional(),
  resolution: z.enum(['match', 'else', 'replan']).optional(),
  traces: z.array(RoutingEvaluationTraceSchema),
  metadata: z.record(z.unknown()).optional()
})
export type RoutingEvaluationResult = z.infer<typeof RoutingEvaluationResultSchema>

type RawRoutingCondition = string | ConditionValidationInput | RoutingCondition

type RawRoutingEdge = {
  to?: unknown
  if?: RawRoutingCondition
  condition?: RawRoutingCondition
  label?: unknown
  metadata?: unknown
}

type RawRoutingNode = {
  routes?: unknown
  elseTo?: unknown
  metadata?: unknown
}

export function compileRoutingCondition(input: RawRoutingCondition): RoutingCondition {
  if (typeof input === 'string') {
    const normalized = normalizeConditionInput({ dsl: input })
    return formatCondition(input, normalized)
  }

  if (isRoutingCondition(input)) {
    return {
      dsl: input.dsl,
      canonicalDsl: input.canonicalDsl ?? input.dsl,
      jsonLogic: input.jsonLogic,
      warnings: input.warnings ? [...input.warnings] : [],
      variables: input.variables ? [...input.variables] : []
    }
  }

  if (input && typeof input === 'object') {
    const normalized = normalizeConditionInput(input)
    const providedDsl =
      typeof (input as ConditionValidationInput).dsl === 'string'
        ? (input as ConditionValidationInput).dsl
        : null
    const canonical = normalized.canonicalDsl && normalized.canonicalDsl.length ? normalized.canonicalDsl : null
    const dsl = providedDsl && providedDsl.length ? providedDsl : canonical ?? 'json_logic_condition'
    return formatCondition(dsl, normalized)
  }

  throw buildInvalidConditionError('Routing condition must include a `dsl` string or `jsonLogic` payload.')
}

export function compileRoutingEdge(input: unknown): RoutingEdge {
  if (!input || typeof input !== 'object') {
    throw new Error('Routing edge must be an object including `to` and `if`/`condition`.')
  }
  const record = input as RawRoutingEdge
  const to = typeof record.to === 'string' ? record.to.trim() : null
  if (!to) {
    throw new Error('Routing edge is missing a `to` node reference.')
  }
  const rawCondition = record.condition ?? record.if
  if (!rawCondition) {
    throw new Error(`Routing edge "${to}" is missing an \`if\` condition.`)
  }
  const condition = compileRoutingCondition(rawCondition)
  const label = typeof record.label === 'string' ? record.label : undefined
  const metadata = record.metadata && typeof record.metadata === 'object'
    ? (record.metadata as Record<string, unknown>)
    : undefined
  return { to, condition, label, metadata }
}

export function compileConditionalRoutingNode(input: unknown): ConditionalRoutingNode {
  if (!input || typeof input !== 'object') {
    throw new Error('Routing node definition must be an object.')
  }
  const record = input as RawRoutingNode
  if (!Array.isArray(record.routes) || record.routes.length === 0) {
    throw new Error('Routing node requires at least one `routes` entry.')
  }
  const routes = record.routes.map((route) => compileRoutingEdge(route))
  const elseTo = typeof record.elseTo === 'string' ? record.elseTo.trim() : undefined
  const metadata = record.metadata && typeof record.metadata === 'object'
    ? (record.metadata as Record<string, unknown>)
    : undefined
  return ConditionalRoutingNodeSchema.parse({ routes, elseTo, metadata })
}

function formatCondition(dsl: string, normalized: ConditionValidationResult): RoutingCondition {
  const canonical = normalized.canonicalDsl ?? dsl
  const warnings = normalized.warnings ? [...normalized.warnings] : []
  const variables = normalized.variables ? [...normalized.variables] : []
  return {
    dsl,
    canonicalDsl: canonical,
    jsonLogic: normalized.jsonLogic,
    warnings,
    variables
  }
}

function isRoutingCondition(value: unknown): value is RoutingCondition {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { dsl?: unknown }).dsl === 'string' &&
    Object.prototype.hasOwnProperty.call(value, 'jsonLogic')
  )
}

function buildInvalidConditionError(message: string): ConditionDslValidationError {
  return new ConditionDslValidationError([
    {
      code: 'empty_expression',
      message,
      range: {
        start: { offset: 0, line: 1, column: 1 },
        end: { offset: 0, line: 1, column: 1 }
      }
    }
  ])
}
