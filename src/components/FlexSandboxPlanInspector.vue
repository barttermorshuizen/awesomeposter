<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CapabilityRecord } from '@awesomeposter/shared'
import type { FlexSandboxPlan, FlexSandboxPlanNode, FlexSandboxPlanHistoryEntry } from '@/lib/flexSandboxTypes'

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
</style>
