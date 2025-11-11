import {
  evaluateCondition,
  normalizeConditionInput,
  type FacetCondition,
  type GoalConditionResult,
  type JsonLogicExpression
} from '@awesomeposter/shared'
import type { RunContextSnapshot } from './run-context'

type EvaluationOptions = {
  runContextSnapshot?: RunContextSnapshot | null
}

type PointerResolution = {
  value: unknown
  lastSegment: string | null
}

export function evaluateGoalConditions(
  conditions: readonly FacetCondition[] | null | undefined,
  options: EvaluationOptions = {}
): GoalConditionResult[] {
  if (!conditions || !conditions.length) {
    return []
  }
  const snapshot = options.runContextSnapshot ?? null
  const results: GoalConditionResult[] = []

  for (const entry of conditions) {
    const expression =
      typeof entry.condition.canonicalDsl === 'string' && entry.condition.canonicalDsl.trim().length
        ? entry.condition.canonicalDsl
        : entry.condition.dsl
    let satisfied = false
    let error: string | undefined

    const facetValue = extractFacetValue(snapshot, entry.facet)
    if (facetValue === undefined) {
      error = `Facet "${entry.facet}" not found in run context snapshot.`
      results.push({
        facet: entry.facet,
        path: entry.path,
        expression,
        satisfied,
        error
      })
      continue
    }

    const resolution = resolvePointerValue(facetValue, entry.path)
    if (resolution.value === undefined) {
      error = `Path "${entry.path}" did not resolve within facet "${entry.facet}".`
      results.push({
        facet: entry.facet,
        path: entry.path,
        expression,
        satisfied,
        error
      })
      continue
    }

    const payload = buildEvaluationPayload(resolution.value, resolution.lastSegment, snapshot)
    const logicResult = resolveJsonLogic(entry.condition)
    if (!logicResult.jsonLogic) {
      error = logicResult.error ?? 'Missing JSON-Logic payload for condition.'
      results.push({
        facet: entry.facet,
        path: entry.path,
        expression,
        satisfied,
        error
      })
      continue
    }

    const evaluation = evaluateCondition(logicResult.jsonLogic, payload)
    if (evaluation.ok) {
      satisfied = Boolean(evaluation.result)
    } else {
      error = evaluation.error ?? 'Condition evaluation failed.'
    }

    results.push({
      facet: entry.facet,
      path: entry.path,
      expression,
      satisfied,
      ...(error ? { error } : {})
    })
  }

  return results
}

function extractFacetValue(snapshot: RunContextSnapshot | null, facet: string): unknown {
  if (!snapshot || !snapshot.facets) return undefined
  const entry = snapshot.facets[facet]
  if (!entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'value')) {
    return undefined
  }
  return cloneValue((entry as { value: unknown }).value)
}

function resolveJsonLogic(
  condition: FacetCondition['condition']
): { jsonLogic: JsonLogicExpression | null; error?: string } {
  if (condition.jsonLogic && typeof condition.jsonLogic === 'object') {
    return { jsonLogic: condition.jsonLogic as JsonLogicExpression }
  }
  try {
    const normalized = normalizeConditionInput({ dsl: condition.dsl, jsonLogic: condition.jsonLogic })
    return { jsonLogic: normalized.jsonLogic }
  } catch (err) {
    return {
      jsonLogic: null,
      error: err instanceof Error ? err.message : 'Unable to normalize condition.'
    }
  }
}

function buildEvaluationPayload(
  contextValue: unknown,
  fallbackKey: string | null,
  snapshot: RunContextSnapshot | null
) {
  let payload: any
  if (contextValue && typeof contextValue === 'object') {
    payload = cloneValue(contextValue)
  } else {
    const key = fallbackKey && fallbackKey.length ? fallbackKey : 'value'
    payload = { [key]: contextValue ?? null }
  }

  attachRunContextMetadata(payload, snapshot)
  return payload
}

function attachRunContextMetadata(target: unknown, snapshot: RunContextSnapshot | null) {
  if (!target || typeof target !== 'object') {
    return
  }
  const container = target as Record<string, unknown>
  if (!Object.prototype.hasOwnProperty.call(container, 'metadata')) {
    container.metadata = { runContextSnapshot: snapshot ?? null }
    return
  }
  const metadata = container.metadata
  if (metadata && typeof metadata === 'object' && !Object.prototype.hasOwnProperty.call(metadata, 'runContextSnapshot')) {
    ;(metadata as Record<string, unknown>).runContextSnapshot = snapshot ?? null
  }
}

function resolvePointerValue(baseValue: unknown, path: string): PointerResolution {
  if (!path || path === '#/' || path === '#') {
    return { value: baseValue, lastSegment: null }
  }
  let normalized = path.trim()
  if (!normalized.startsWith('#') && !normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  if (normalized.startsWith('#')) {
    normalized = normalized.slice(1)
  }
  normalized = normalized.replace(/\[(\d+)\]/g, '/$1')
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  const rawSegments = normalized
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
    .filter((segment) => segment.length > 0)

  if (!rawSegments.length) {
    return { value: baseValue, lastSegment: null }
  }

  let current: unknown = baseValue
  for (const segment of rawSegments) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        return { value: undefined, lastSegment: segment }
      }
      current = current[index]
      continue
    }
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[segment]
      continue
    }
    return { value: undefined, lastSegment: segment }
  }

  return {
    value: cloneValue(current),
    lastSegment: rawSegments[rawSegments.length - 1] ?? null
  }
}

function cloneValue<T>(value: T): T {
  if (value === null || value === undefined) return value
  if (typeof value !== 'object') return value
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}
