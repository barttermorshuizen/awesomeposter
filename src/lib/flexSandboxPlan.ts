import type { FlexSandboxPlanHistoryEntry, FlexSandboxPlanNode } from '@/lib/flexSandboxTypes'

type ExtractedPlan = {
  runId?: string | null
  version?: number
  metadata?: Record<string, unknown> | null
  nodes: FlexSandboxPlanNode[]
}

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
  const nodes: FlexSandboxPlanNode[] = nodesRaw
    .filter((node): node is Record<string, unknown> => !!node && typeof node === 'object')
    .map((node) => {
      const statusRaw = (node as Record<string, unknown>).status
      const status: FlexSandboxPlanNode['status'] =
        statusRaw === 'running' || statusRaw === 'completed' || statusRaw === 'error' || statusRaw === 'awaiting_hitl'
          ? statusRaw
          : 'pending'
      const derived = (node as Record<string, unknown>).derivedCapability
      const metadataValue = (node as Record<string, unknown>).metadata
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
            : null
      }
    })
    .filter((node) => node.id.length > 0)

  return {
    runId: typeof planRecord.runId === 'string' ? planRecord.runId : null,
    version: typeof planRecord.version === 'number' ? planRecord.version : undefined,
    metadata:
      planRecord.metadata && typeof planRecord.metadata === 'object'
        ? (planRecord.metadata as Record<string, unknown>)
        : null,
    nodes
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
