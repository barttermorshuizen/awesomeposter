import type { FlexPostConditionGuard, FlexPostConditionResult } from '@awesomeposter/shared'

export type GuardStatus = 'pass' | 'fail' | 'pending' | 'error'

export type GuardState = {
  facet: string
  path: string
  status: GuardStatus
  guard?: FlexPostConditionGuard
  result?: FlexPostConditionResult
  nodeId?: string
  capabilityId?: string | null
}

export type GuardSummary = {
  total: number
  pass: number
  fail: number
  pending: number
  error: number
  latestFailure: GuardState | null
}

type GuardCarrier = {
  postConditionGuards?: FlexPostConditionGuard[] | null
  postConditionResults?: FlexPostConditionResult[] | null
  id?: string
  capabilityId?: string | null
}

function guardKey(facet: string, path: string) {
  return `${facet}::${path}`
}

function normalizeGuards(guards: FlexPostConditionGuard[] | null | undefined): FlexPostConditionGuard[] {
  if (!guards || !Array.isArray(guards)) return []
  return guards.filter(
    (entry) => entry && typeof entry.facet === 'string' && entry.facet && typeof entry.path === 'string' && entry.path
  )
}

function normalizeResults(results: FlexPostConditionResult[] | null | undefined): FlexPostConditionResult[] {
  if (!results || !Array.isArray(results)) return []
  return results.filter(
    (entry) => entry && typeof entry.facet === 'string' && entry.facet && typeof entry.path === 'string' && entry.path
  )
}

function statusForResult(result: FlexPostConditionResult | undefined): GuardStatus {
  if (!result) return 'pending'
  if (typeof result.error === 'string' && result.error.length) return 'error'
  return result.satisfied ? 'pass' : 'fail'
}

export function buildGuardStates(node: GuardCarrier): GuardState[] {
  const guards = normalizeGuards(node.postConditionGuards)
  const results = normalizeResults(node.postConditionResults)

  const resultMap = new Map<string, FlexPostConditionResult>()
  for (const result of results) {
    resultMap.set(guardKey(result.facet, result.path), result)
  }

  const states: GuardState[] = guards.map((guard) => {
    const key = guardKey(guard.facet, guard.path)
    const result = resultMap.get(key)
    return {
      facet: guard.facet,
      path: guard.path,
      guard,
      result,
      status: statusForResult(result),
      nodeId: node.id,
      capabilityId: node.capabilityId ?? null
    }
  })

  for (const result of results) {
    const key = guardKey(result.facet, result.path)
    if (!resultMap.has(key) || !guards.some((guard) => guardKey(guard.facet, guard.path) === key)) {
      states.push({
        facet: result.facet,
        path: result.path,
        result,
        status: statusForResult(result),
        nodeId: node.id,
        capabilityId: node.capabilityId ?? null
      })
    }
  }

  return states
}

export function summarizeGuardStates(nodes: GuardCarrier[]): GuardSummary {
  const summary: GuardSummary = {
    total: 0,
    pass: 0,
    fail: 0,
    pending: 0,
    error: 0,
    latestFailure: null
  }

  for (const node of nodes) {
    const states = buildGuardStates(node)
    for (const state of states) {
      summary.total += 1
      switch (state.status) {
        case 'pass':
          summary.pass += 1
          break
        case 'fail':
          summary.fail += 1
          summary.latestFailure = state
          break
        case 'error':
          summary.error += 1
          summary.latestFailure = state
          break
        default:
          summary.pending += 1
          break
      }
    }
  }

  return summary
}
