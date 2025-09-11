<script setup lang="ts">
import { computed } from 'vue'

type Structure = { lengthLevel?: number; scanDensity?: number } | null | undefined
type KnobsLike = {
  formatType?: string | null
  hookIntensity?: number | null
  expertiseDepth?: number | null
  structure?: Structure
} | null | undefined

interface Props {
  knobs: KnobsLike
}

const props = defineProps<Props>()

function clamp01(n: unknown): number | null {
  const x = typeof n === 'number' ? n : Number(n)
  if (!Number.isFinite(x)) return null
  return Math.max(0, Math.min(1, x))
}

const values = computed(() => {
  const k = props.knobs || {}
  const hook = clamp01((k as any).hookIntensity)
  const depth = clamp01((k as any).expertiseDepth)
  const s = (k as any).structure || {}
  const length = clamp01((s as any).lengthLevel)
  const scan = clamp01((s as any).scanDensity)
  return { hook, depth, length, scan }
})

const pct = (n: number | null) => (n == null ? null : Math.round(n * 100))

function formatIcon(fmt?: string | null): { icon: string; label: string; color: string } {
  const f = String(fmt || '').toLowerCase()
  switch (f) {
    case 'single_image':
      return { icon: 'mdi-image-outline', label: 'Single Image', color: 'amber' }
    case 'multi_image':
      return { icon: 'mdi-image-multiple-outline', label: 'Multi Image', color: 'orange' }
    case 'document_pdf':
      return { icon: 'mdi-file-pdf-box', label: 'Document (PDF)', color: 'red' }
    case 'video':
      return { icon: 'mdi-video-outline', label: 'Video', color: 'purple' }
    case 'text':
    default:
      return { icon: 'mdi-text', label: f ? 'Text' : 'Format', color: 'primary' }
  }
}

const fmt = computed(() => formatIcon((props.knobs as any)?.formatType))
</script>

<template>
  <div class="knobs-wrap">
    <div class="d-flex align-center mb-3">
      <v-chip :color="fmt.color" variant="flat" size="small" class="me-2">
        <v-icon :icon="fmt.icon" start />
        {{ fmt.label }}
      </v-chip>
      <span class="text-caption text-medium-emphasis">Format type</span>
    </div>

    <div class="d-flex flex-wrap ga-4">
      <div class="dial">
        <v-progress-circular
          :model-value="pct(values.hook) ?? 0"
          :indeterminate="values.hook == null"
          size="72"
          width="8"
          color="teal"
        >
          <span class="dial-value">{{ values.hook == null ? '—' : pct(values.hook) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Hook Intensity</div>
      </div>

      <div class="dial">
        <v-progress-circular
          :model-value="pct(values.depth) ?? 0"
          :indeterminate="values.depth == null"
          size="72"
          width="8"
          color="cyan"
        >
          <span class="dial-value">{{ values.depth == null ? '—' : pct(values.depth) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Expertise Depth</div>
      </div>

      <div class="dial">
        <v-progress-circular
          :model-value="pct(values.length) ?? 0"
          :indeterminate="values.length == null"
          size="72"
          width="8"
          color="indigo"
        >
          <span class="dial-value">{{ values.length == null ? '—' : pct(values.length) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Length Level</div>
      </div>

      <div class="dial">
        <v-progress-circular
          :model-value="pct(values.scan) ?? 0"
          :indeterminate="values.scan == null"
          size="72"
          width="8"
          color="deep-purple"
        >
          <span class="dial-value">{{ values.scan == null ? '—' : pct(values.scan) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Scan Density</div>
      </div>
    </div>
  </div>
  
</template>

<style scoped>
.knobs-wrap { }
.dial { display: inline-flex; flex-direction: column; align-items: center; gap: 6px; min-width: 110px; }
.dial-value { font-size: 12px; font-weight: 600; }
.dial-label { font-size: 12px; color: rgba(255,255,255,0.7); }
.ga-4 { gap: 16px; }
</style>

