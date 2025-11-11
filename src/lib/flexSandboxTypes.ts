import type { ConditionalRoutingNode, RoutingEvaluationResult } from '@awesomeposter/shared'

export type FlexSandboxPlanNodeStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'error'
  | 'awaiting_hitl'
  | 'awaiting_human'

export type FlexSandboxPlanEdge = {
  from: string
  to: string
  reason?: string | null
}

export type FlexSandboxPlanNode = {
  id: string
  capabilityId: string | null
  label: string | null
  status: FlexSandboxPlanNodeStatus
  kind?: string | null
  derivedFrom?: string | null
  facets?: {
    input?: string[]
    output?: string[]
  } | null
  contracts?: {
    inputMode?: string
    outputMode?: string
  } | null
  metadata?: Record<string, unknown> | null
  lastUpdatedAt?: string
  routing?: ConditionalRoutingNode | null
  routingResult?: RoutingEvaluationResult | null
}

export type FlexSandboxPlanHistoryEntry = {
  version: number
  timestamp: string
  trigger?: unknown
}

export type FlexSandboxPlan = {
  runId?: string | null
  version?: number
  metadata?: Record<string, unknown> | null
  nodes: FlexSandboxPlanNode[]
  history: FlexSandboxPlanHistoryEntry[]
  edges: FlexSandboxPlanEdge[]
}
