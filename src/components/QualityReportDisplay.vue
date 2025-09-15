<script setup lang="ts">
import { computed, watch } from 'vue'
import type { QAReport } from '@awesomeposter/shared'

interface Props { report: QAReport | Record<string, unknown> | null | undefined }

const props = defineProps<Props>()

function num01(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

function firstNum01(...vals: unknown[]): number | null {
  for (const v of vals) {
    const n = num01(v)
    if (n != null) return n
  }
  return null
}

const vals = computed(() => {
  const r = (props.report || {}) as Record<string, any>
  const m = (r.metrics && typeof r.metrics === 'object') ? (r.metrics as Record<string, any>) : {}
  const composite = firstNum01(r.composite, r.score, m.composite)
  const compliance = ((): boolean => {
    if (typeof r.compliance === 'boolean') return r.compliance
    if (typeof r.pass === 'boolean') return r.pass
    if (typeof m.compliance === 'boolean') return m.compliance
    return false
  })()
  return {
    readability: firstNum01(r.readability, m.readability),
    clarity: firstNum01(r.clarity, m.clarity),
    objectiveFit: firstNum01(r.objectiveFit, m.objectiveFit),
    brandRisk: firstNum01(r.brandRisk, m.brandRisk),
    compliance,
    composite
  }
})

// Debug logging (dev or when VITE_DEBUG_QUALITY=1)
const DEBUG_Q = (import.meta as any).env?.DEV || ((import.meta as any).env?.VITE_DEBUG_QUALITY === '1')
if (DEBUG_Q) {
  watch(() => props.report, (r) => {
    try { console.groupCollapsed('[QualityReportDisplay] incoming report'); console.log(r); console.groupEnd(); } catch {}
  }, { deep: true, immediate: true })
  watch(vals, (v) => {
    try { console.groupCollapsed('[QualityReportDisplay] computed vals'); console.log(v); console.groupEnd(); } catch {}
  }, { immediate: true })
}

const pct = (n: number | null) => (n == null ? null : Math.round(n * 100))
</script>

<template>
  <div class="qr-wrap">
    <div class="d-flex flex-wrap align-center justify-space-between mb-4 ga-3">
      <div class="overall">
        <div class="overall-number">{{ vals.composite == null ? '—' : pct(vals.composite) + '%' }}</div>
        <div class="overall-label">Overall Quality</div>
      </div>
      <v-checkbox
        :model-value="vals.compliance"
        label="Compliance"
        density="comfortable"
        hide-details
        readonly
      />
    </div>

    <div class="d-flex flex-wrap ga-4">
      <div class="dial">
        <v-progress-circular
          :model-value="pct(vals.readability) ?? 0"
          size="72"
          width="8"
          color="teal"
        >
          <span class="dial-value">{{ vals.readability == null ? '—' : pct(vals.readability) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Readability</div>
      </div>

      <div class="dial">
        <v-progress-circular
          :model-value="pct(vals.clarity) ?? 0"
          size="72"
          width="8"
          color="cyan"
        >
          <span class="dial-value">{{ vals.clarity == null ? '—' : pct(vals.clarity) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Clarity</div>
      </div>

      <div class="dial">
        <v-progress-circular
          :model-value="pct(vals.objectiveFit) ?? 0"
          size="72"
          width="8"
          color="indigo"
        >
          <span class="dial-value">{{ vals.objectiveFit == null ? '—' : pct(vals.objectiveFit) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Objective Fit</div>
      </div>

      <div class="dial">
        <v-progress-circular
          :model-value="pct(vals.brandRisk) ?? 0"
          size="72"
          width="8"
          color="red"
        >
          <span class="dial-value">{{ vals.brandRisk == null ? '—' : pct(vals.brandRisk) + '%' }}</span>
        </v-progress-circular>
        <div class="dial-label">Brand Risk</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.qr-wrap { }
.overall { display: inline-flex; flex-direction: column; align-items: center; justify-content: center; min-width: 140px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }
.overall-number { font-size: 28px; font-weight: 700; line-height: 1; }
.overall-label { font-size: 12px; color: rgba(255,255,255,0.7); margin-top: 4px; }
.dial { display: inline-flex; flex-direction: column; align-items: center; gap: 6px; min-width: 110px; }
.dial-value { font-size: 12px; font-weight: 600; }
.dial-label { font-size: 12px; color: rgba(255,255,255,0.7); }
.ga-3 { gap: 12px; }
.ga-4 { gap: 16px; }
</style>
