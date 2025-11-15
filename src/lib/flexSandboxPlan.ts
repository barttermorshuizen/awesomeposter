import type {
  ConditionalRoutingNode,
  RoutingEvaluationResult,
  FlexPostConditionGuard,
  FlexPostConditionResult
} from '@awesomeposter/shared'
import type { FlexSandboxPlanHistoryEntry, FlexSandboxPlanNode, FlexSandboxPlanEdge } from '@/lib/flexSandboxTypes'

type ExtractedPlan = {
  runId?: string | null
  version?: number
  metadata?: Record<string, unknown> | null
  nodes: FlexSandboxPlanNode[]
  edges: FlexSandboxPlanEdge[]
}

const ALLOWED_NODE_STATUSES = new Set<FlexSandboxPlanNode['status']>([
  'pending',
  'running',
  'completed',
  'awaiting_hitl',
  'awaiting_human',
  'error'
])

function normalizePlanRecord(payload: unknown): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null
  const payloadRecord = payload as Record<string, unknown>

  if (payloadRecord.plan && typeof payloadRecord.plan === 'object') {
    return payloadRecord.plan as Record<string, unknown>
  }

  if (Array.isArray(payloadRecord.nodes)) {
    return payloadRecord
  }

  return null
}

export function extractPlanPayload(payload: unknown): ExtractedPlan | null {
  const planRecord = normalizePlanRecord(payload)
  if (!planRecord) return null

  const nodesRaw = Array.isArray(planRecord.nodes) ? (planRecord.nodes as unknown[]) : []
  const versionRaw = (planRecord as Record<string, unknown>).version
  if (typeof versionRaw !== 'number' || Number.isNaN(versionRaw)) {
    throw new Error('Planner plan payload is missing a numeric version.')
  }

  const nodes: FlexSandboxPlanNode[] = nodesRaw
    .filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
    .map((node) => {
      const statusRaw = (node as Record<string, unknown>).status
      const status =
        typeof statusRaw === 'string' && ALLOWED_NODE_STATUSES.has(statusRaw as FlexSandboxPlanNode['status'])
          ? (statusRaw as FlexSandboxPlanNode['status'])
          : null
      if (!status) {
        const nodeId = typeof (node as Record<string, unknown>).id === 'string' ? (node as Record<string, unknown>).id : '<unknown>'
        throw new Error(`Planner plan payload is missing a valid status for node "${nodeId}".`)
      }
      const derived = (node as Record<string, unknown>).derivedCapability
      const metadataValue = (node as Record<string, unknown>).metadata
      const postConditionGuardsValue = (node as Record<string, unknown>).postConditionGuards
      const postConditionResultsValue = (node as Record<string, unknown>).postConditionResults
      return {
        id: typeof node.id === 'string' ? node.id : '',
        capabilityId: typeof node.capabilityId === 'string' ? node.capabilityId : null,
        label: typeof node.label === 'string' ? node.label : null,
        status,
        kind: typeof node.kind === 'string' ? node.kind : null,
        derivedFrom:
          derived && typeof derived === 'object' && typeof (derived as Record<string, unknown>).fromCapabilityId === 'string'
            ? ((derived as Record<string, unknown>).fromCapabilityId as string)
            : null,
        facets:
          node.facets && typeof node.facets === 'object'
            ? {
                input: Array.isArray((node.facets as Record<string, unknown>).input)
                  ? ((node.facets as Record<string, unknown>).input as string[])
                  : undefined,
                output: Array.isArray((node.facets as Record<string, unknown>).output)
                  ? ((node.facets as Record<string, unknown>).output as string[])
                  : undefined
              }
            : null,
        contracts:
          node.contracts && typeof node.contracts === 'object'
            ? {
                inputMode:
                  typeof (node.contracts as Record<string, unknown>).inputMode === 'string'
                    ? ((node.contracts as Record<string, unknown>).inputMode as string)
                    : undefined,
                outputMode:
                  typeof (node.contracts as Record<string, unknown>).outputMode === 'string'
                    ? ((node.contracts as Record<string, unknown>).outputMode as string)
                    : undefined
              }
            : null,
        metadata:
          metadataValue && typeof metadataValue === 'object'
            ? (metadataValue as Record<string, unknown>)
            : null,
        routing:
          node.routing && typeof node.routing === 'object'
            ? (node.routing as ConditionalRoutingNode)
            : null,
        routingResult:
          node.routingResult && typeof node.routingResult === 'object'
            ? (node.routingResult as RoutingEvaluationResult)
            : null,
        postConditionGuards: Array.isArray(postConditionGuardsValue)
          ? (postConditionGuardsValue as FlexPostConditionGuard[])
          : undefined,
        postConditionResults: Array.isArray(postConditionResultsValue)
          ? (postConditionResultsValue as FlexPostConditionResult[])
          : undefined
      }
    })
    .filter((node) => node.id.length > 0)

  const edgesRaw = Array.isArray((planRecord as Record<string, unknown>).edges)
    ? ((planRecord as Record<string, unknown>).edges as unknown[])
    : []
  const edges: FlexSandboxPlanEdge[] = []
  for (const edge of edgesRaw) {
    if (!edge || typeof edge !== 'object') continue
    const record = edge as { from?: unknown; to?: unknown; reason?: unknown }
    const from = typeof record.from === 'string' ? record.from : ''
    const to = typeof record.to === 'string' ? record.to : ''
    if (!from || !to) continue
    const reason =
      typeof record.reason === 'string'
        ? record.reason
        : record.reason === null
          ? null
          : undefined
    edges.push({
      from,
      to,
      ...(reason !== undefined ? { reason } : {})
    })
  }

  return {
    runId: typeof planRecord.runId === 'string' ? planRecord.runId : null,
    version: versionRaw,
    metadata:
      planRecord.metadata && typeof planRecord.metadata === 'object'
        ? (planRecord.metadata as Record<string, unknown>)
        : null,
    nodes,
    edges
  }
}

export function appendHistoryEntry(
  history: FlexSandboxPlanHistoryEntry[],
  entry: FlexSandboxPlanHistoryEntry
): FlexSandboxPlanHistoryEntry[] {
  if (!history.length) return [entry]
  const last = history[history.length - 1]
  if (
    last.version === entry.version &&
    last.timestamp === entry.timestamp &&
    triggersMatch(last.trigger, entry.trigger)
  ) {
    return [...history.slice(0, -1), entry]
  }
  return [...history, entry].slice(-20)
}

function triggersMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b)
    } catch {
      return false
    }
  }
  return false
}
