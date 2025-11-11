<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CapabilityRecord } from '@awesomeposter/shared'
import type {
  FlexSandboxPlan,
  FlexSandboxPlanNode,
  FlexSandboxPlanHistoryEntry,
  FlexSandboxPlanEdge
} from '@/lib/flexSandboxTypes'

interface Props {
  plan: FlexSandboxPlan | null
  capabilityCatalog: CapabilityRecord[] | null
}

const props = defineProps<Props>()

const capabilityLookup = computed(() => {
  const map = new Map<string, CapabilityRecord>()
  if (props.capabilityCatalog) {
    for (const entry of props.capabilityCatalog) {
      map.set(entry.capabilityId, entry)
    }
  }
  return map
})

const nodes = computed<FlexSandboxPlanNode[]>(() => props.plan?.nodes ?? [])
const history = computed<FlexSandboxPlanHistoryEntry[]>(() => props.plan?.history ?? [])
const edgeMap = computed<Map<string, FlexSandboxPlanEdge[]>>(() => {
  const map = new Map<string, FlexSandboxPlanEdge[]>()
  const edges = props.plan?.edges ?? []
  for (const edge of edges) {
    if (!edge || !edge.from || !edge.to) continue
    const list = map.get(edge.from) ?? []
    list.push(edge)
    map.set(edge.from, list)
  }
  return map
})
const metadataExpanded = ref(false)

function statusColor(status: FlexSandboxPlanNode['status']): string {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'primary'
    case 'awaiting_hitl':
      return 'warning'
    case 'error':
      return 'error'
    default:
      return 'secondary'
  }
}

function statusLabel(status: FlexSandboxPlanNode['status']): string {
  switch (status) {
    case 'completed':
      return 'Completed'
    case 'running':
      return 'Running'
    case 'awaiting_hitl':
      return 'HITL pause'
    case 'error':
      return 'Error'
    default:
      return 'Pending'
  }
}

function capabilityLabel(node: FlexSandboxPlanNode): string {
  if (!node.capabilityId) return 'Virtual node'
  const entry = capabilityLookup.value.get(node.capabilityId)
  return entry?.displayName ?? node.capabilityId
}

function derivedDescription(node: FlexSandboxPlanNode): string | null {
  if (node.derivedFrom) {
    const origin = capabilityLookup.value.get(node.derivedFrom)
    return origin ? `Derived via ${origin.displayName}` : `Derived via ${node.derivedFrom}`
  }
  if (node.metadata && typeof node.metadata.derived === 'boolean' && node.metadata.derived) {
    return 'Derived capability'
  }
  if (node.metadata && typeof node.metadata.plannerDerived === 'boolean' && node.metadata.plannerDerived) {
    return 'Planner flagged as derived'
  }
  return null
}

function formatTimestamp(timestamp: string | undefined): string | null {
  if (!timestamp) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function formatJson(value: unknown): string | null {
  if (value === null || value === undefined) return null
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function downstreamEdges(nodeId: string): FlexSandboxPlanEdge[] {
  return edgeMap.value.get(nodeId) ?? []
}

function routingTrace(node: FlexSandboxPlanNode, targetId: string) {
  const traces = node.routingResult?.traces ?? []
  return traces.find((trace) => trace.to === targetId) ?? null
}

function routeIcon(trace: ReturnType<typeof routingTrace>) {
  if (!trace) return { icon: 'mdi-checkbox-blank-circle-outline', color: 'secondary' }
  if (trace.error) return { icon: 'mdi-alert-circle', color: 'warning' }
  if (trace.matched) return { icon: 'mdi-check-circle', color: 'success' }
  return { icon: 'mdi-close-circle', color: 'secondary' }
}

function routeStatusText(trace: ReturnType<typeof routingTrace>): string {
  if (!trace) return 'Pending evaluation'
  if (trace.error) return 'Evaluation failed'
  return trace.matched ? 'Matched' : 'Not matched'
}

function elseBranchState(node: FlexSandboxPlanNode): 'selected' | 'available' {
  return node.routingResult?.resolution === 'else' ? 'selected' : 'available'
}
</script>

<template>
  <v-card>
    <v-card-title class="d-flex flex-column">
      <div class="d-flex align-center justify-space-between w-100">
        <span>Plan Inspector</span>
        <v-chip
          v-if="plan?.version !== undefined"
          size="small"
          color="primary"
          class="text-caption"
        >
          v{{ plan?.version ?? 1 }}
        </v-chip>
      </div>
      <div v-if="plan?.runId" class="text-caption text-medium-emphasis mt-1">
        Run {{ plan.runId }}
      </div>
    </v-card-title>
    <v-card-text>
      <v-alert
        v-if="!nodes.length"
        type="info"
        variant="tonal"
        class="mb-4"
        text="Planner has not produced any nodes yet."
      />
      <template v-else>
        <v-expansion-panels multiple>
          <v-expansion-panel v-for="node in nodes" :key="node.id">
            <v-expansion-panel-title>
              <div class="d-flex flex-column w-100">
                <div class="d-flex align-center justify-space-between">
                  <span class="text-subtitle-2">
                    {{ node.label || capabilityLabel(node) }}
                  </span>
                  <v-chip
                    size="small"
                    :color="statusColor(node.status)"
                    class="text-caption"
                  >
                    {{ statusLabel(node.status) }}
                  </v-chip>
                </div>
                <div class="text-caption text-medium-emphasis d-flex flex-wrap ga-2 mt-1">
                  <span>
                    {{ capabilityLabel(node) }}
                    <template v-if="node.capabilityId"> · {{ node.capabilityId }}</template>
                  </span>
                  <span v-if="node.kind"> · Kind: {{ node.kind }}</span>
                  <span v-if="node.lastUpdatedAt">
                    · Updated {{ formatTimestamp(node.lastUpdatedAt) ?? node.lastUpdatedAt }}
                  </span>
                </div>
              </div>
            </v-expansion-panel-title>
            <v-expansion-panel-text>
              <div class="d-flex flex-column ga-3">
                <div v-if="derivedDescription(node)" class="text-body-2">
                  <v-icon icon="mdi-creation" size="18" class="me-1 text-warning" />
                  {{ derivedDescription(node) }}
                </div>
                <div v-if="node.routing" class="routing-section">
                  <div class="text-caption text-medium-emphasis mb-1">Conditional routes</div>
                  <div
                    v-if="node.routingResult"
                    class="text-caption text-medium-emphasis mb-1"
                  >
                    Selected target:
                    <code>{{ node.routingResult.selectedTarget ?? 'none' }}</code>
                    <span
                      v-if="node.routingResult.resolution === 'else'"
                      class="ms-1"
                    >
                      (else branch)
                    </span>
                    <span
                      v-else-if="node.routingResult.resolution === 'replan'"
                      class="text-warning ms-1"
                    >
                      replan requested
                    </span>
                  </div>
                  <ul class="routing-list">
                    <li
                      v-for="route in node.routing.routes"
                      :key="`${node.id}-${route.to}`"
                      class="routing-list__item"
                    >
                      <v-icon
                        v-bind="routeIcon(routingTrace(node, route.to))"
                        size="16"
                        class="me-2"
                      />
                      <div class="flex-grow-1">
                        <div class="text-body-2">
                          {{ route.label || 'Route' }}
                          <span class="text-medium-emphasis">
                            → {{ route.to }}
                          </span>
                        </div>
                        <div class="text-caption text-medium-emphasis">
                          IF {{ route.condition?.dsl || 'expression' }}
                        </div>
                        <div class="text-caption text-medium-emphasis">
                          {{ routeStatusText(routingTrace(node, route.to)) }}
                        </div>
                        <div
                          v-if="routingTrace(node, route.to)?.error"
                          class="text-caption text-warning mt-1"
                        >
                          {{ routingTrace(node, route.to)?.error }}
                        </div>
                      </div>
                    </li>
                  </ul>
                  <div v-if="node.routing.elseTo" class="text-body-2 mt-1">
                    <v-icon
                      :icon="elseBranchState(node) === 'selected' ? 'mdi-check-circle' : 'mdi-arrow-right-drop-circle'"
                      :color="elseBranchState(node) === 'selected' ? 'success' : 'secondary'"
                      size="16"
                      class="me-2"
                    />
                    Else → <code>{{ node.routing.elseTo }}</code>
                    <span
                      v-if="elseBranchState(node) === 'selected'"
                      class="text-caption text-medium-emphasis ms-1"
                    >
                      Selected
                    </span>
                  </div>
                  <div
                    v-if="node.routingResult?.resolution === 'replan'"
                    class="text-caption text-warning mt-1"
                  >
                    No routes matched; planner requested a replan.
                  </div>
                </div>
                <div v-if="node.facets && (node.facets.input?.length || node.facets.output?.length)">
                  <div class="text-caption text-medium-emphasis mb-1">Facets</div>
                  <div class="d-flex flex-wrap ga-2">
                    <v-chip v-for="facet in node.facets?.input ?? []" :key="`in-${node.id}-${facet}`" size="small" color="info" variant="outlined">
                      In: {{ facet }}
                    </v-chip>
                    <v-chip v-for="facet in node.facets?.output ?? []" :key="`out-${node.id}-${facet}`" size="small" color="primary" variant="outlined">
                      Out: {{ facet }}
                    </v-chip>
                  </div>
                </div>
                <div v-if="node.contracts">
                  <div class="text-caption text-medium-emphasis mb-1">Contracts</div>
                  <div class="d-flex flex-wrap ga-2 text-body-2">
                    <span v-if="node.contracts.inputMode">Input: {{ node.contracts.inputMode }}</span>
                    <span>Output: {{ node.contracts.outputMode || 'json_schema' }}</span>
                  </div>
                </div>
                <div v-if="node.metadata">
                  <div class="text-caption text-medium-emphasis mb-1">Metadata</div>
                  <pre class="metadata-block">{{ formatJson(node.metadata) }}</pre>
                </div>
                <div v-if="downstreamEdges(node.id).length" class="edges-section">
                  <div class="text-caption text-medium-emphasis mb-1">Downstream edges</div>
                  <div class="d-flex flex-wrap ga-2">
                    <v-chip
                      v-for="edge in downstreamEdges(node.id)"
                      :key="`${node.id}-${edge.to}-${edge.reason ?? 'edge'}`"
                      size="x-small"
                      color="info"
                      variant="outlined"
                    >
                      → {{ edge.to }}
                      <span v-if="edge.reason" class="text-medium-emphasis ms-1">
                        ({{ edge.reason }})
                      </span>
                    </v-chip>
                  </div>
                </div>
              </div>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </template>

      <div v-if="plan?.metadata && Object.keys(plan.metadata).length" class="mt-6">
        <div class="d-flex align-center justify-space-between">
          <h4 class="text-subtitle-2 mb-2">Plan Metadata</h4>
          <v-btn
            icon
            size="x-small"
            variant="text"
            :title="metadataExpanded ? 'Collapse metadata' : 'Expand metadata'"
            @click="metadataExpanded = !metadataExpanded"
          >
            <v-icon :icon="metadataExpanded ? 'mdi-chevron-up' : 'mdi-chevron-down'" />
          </v-btn>
        </div>
        <transition name="expand">
          <pre v-if="metadataExpanded" class="metadata-block">{{ formatJson(plan.metadata) }}</pre>
        </transition>
      </div>

      <div v-if="history.length" class="mt-6">
        <h4 class="text-subtitle-2 mb-2">Plan History</h4>
        <v-timeline side="end" density="compact">
          <v-timeline-item
            v-for="entry in history"
            :key="`${entry.version}-${entry.timestamp}`"
            dot-color="primary"
            size="x-small"
          >
            <div class="text-body-2 d-flex flex-column">
              <span>Version {{ entry.version }}</span>
              <span class="text-caption text-medium-emphasis">
                {{ formatTimestamp(entry.timestamp) ?? entry.timestamp }}
              </span>
              <div v-if="entry.trigger" class="history-trigger mt-1">
                <span class="text-caption text-medium-emphasis">Trigger</span>
                <span
                  v-if="typeof entry.trigger === 'string'"
                  class="text-caption d-block"
                >
                  {{ entry.trigger }}
                </span>
                <pre
                  v-else
                  class="metadata-block history-trigger-json mt-1"
                >{{ formatJson(entry.trigger) }}</pre>
              </div>
            </div>
          </v-timeline-item>
        </v-timeline>
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.metadata-block {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
  font-size: 12px;
  line-height: 1.4;
  overflow-x: auto;
}
.expand-enter-active,
.expand-leave-active {
  transition: all 0.15s ease;
}
.expand-enter-from,
.expand-leave-to {
  max-height: 0;
  opacity: 0;
}

.history-trigger-json {
  white-space: pre-wrap;
}

.routing-section {
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 12px;
}

.routing-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.routing-list__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
}

.edges-section {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
}
</style>
