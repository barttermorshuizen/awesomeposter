<script setup lang="ts">
import { computed } from 'vue'

type QualityReport = {
  readability?: number
  clarity?: number
  objectiveFit?: number
  brandRisk?: number
  compliance?: boolean
  composite?: number
} | Record<string, unknown> | null | undefined

interface Props {
  report: QualityReport
}

const props = defineProps<Props>()

function num01(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(1, n))
}

const vals = computed(() => {
  const r = (props.report || {}) as Record<string, unknown>
  const m = (r.metrics && typeof r.metrics === 'object') ? (r.metrics as Record<string, unknown>) : {}
  const composite = num01((r as any).composite ?? (r as any).score ?? (m as any).composite)
  const compliance = ((): boolean => {
    const a = (r as any).compliance
    if (typeof a === 'boolean') return a
    const b = (r as any).pass
    if (typeof b === 'boolean') return b
    const c = (m as any).compliance
    return Boolean(c)
  })()
  return {
    readability: num01(r.readability ?? m.readability),
    clarity: num01(r.clarity ?? m.clarity),
    objectiveFit: num01(r.objectiveFit ?? m.objectiveFit),
    brandRisk: num01(r.brandRisk ?? m.brandRisk),
    compliance,
    composite
  }
})

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
