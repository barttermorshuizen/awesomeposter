<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNotificationsStore } from '@/stores/notifications'
import type { FacetWidgetProps } from './types'
import type {
  CompanyInformationAssetRecord,
  CompanyInformationFacetRecord
} from '@/stores/flexTasks'

const props = defineProps<FacetWidgetProps>()

const notifications = useNotificationsStore()
const failedThumbnails = ref<Set<string>>(new Set())

const EMPTY_COMPANY: CompanyInformationFacetRecord = {
  name: null,
  website: null,
  industry: null,
  toneOfVoice: null,
  specialInstructions: null,
  audienceSegments: null,
  preferredChannels: null,
  brandAssets: []
}

function isCompanyInformationFacetRecord(
  value: unknown
): value is CompanyInformationFacetRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as CompanyInformationFacetRecord
  if (!Array.isArray(record.brandAssets)) return false
  return record.brandAssets.every(isCompanyInformationAssetRecord)
}

function isCompanyInformationAssetRecord(
  value: unknown
): value is CompanyInformationAssetRecord {
  if (!value || typeof value !== 'object') return false
  const record = value as CompanyInformationAssetRecord
  return typeof record.uri === 'string' && typeof record.label === 'string'
}

function normalizeUrlCandidate(candidate: string | null): string | null {
  if (!candidate) return null
  try {
    const parsed = new URL(candidate)
    const normalized = parsed.toString()
    if (!candidate.endsWith('/') && normalized.endsWith('/')) {
      return normalized.slice(0, -1)
    }
    return normalized
  } catch {
    return candidate
  }
}

function toDisplayString(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function derivePlaceholderLabel(label: string): string {
  return `${label} not provided`
}

function extractExtension(uri: string): string | null {
  const cleaned = uri.split(/[?#]/)[0] ?? uri
  const lastSegment = cleaned.split('/').at(-1) ?? ''
  if (!lastSegment.includes('.')) return null
  const ext = lastSegment.split('.').at(-1)
  return ext ? ext.toLowerCase() : null
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif'
])

const company = computed<CompanyInformationFacetRecord>(() => {
  if (isCompanyInformationFacetRecord(props.modelValue)) {
    return props.modelValue
  }
  return EMPTY_COMPANY
})

const companyName = computed(() => toDisplayString(company.value.name) ?? 'Company name unavailable')

const websiteHref = computed(() => normalizeUrlCandidate(toDisplayString(company.value.website)))

const infoFields = computed<
  Array<{ key: string; label: string; value: string | null }>
>(() => [
  {
    key: 'industry',
    label: 'Industry',
    value: toDisplayString(company.value.industry)
  },
  {
    key: 'tone_of_voice',
    label: 'Tone of Voice',
    value: toDisplayString(company.value.toneOfVoice)
  },
  {
    key: 'audience_segments',
    label: 'Audience Segments',
    value: toDisplayString(company.value.audienceSegments)
  },
  {
    key: 'preferred_channels',
    label: 'Preferred Channels',
    value: toDisplayString(company.value.preferredChannels)
  }
])

const specialInstructions = computed(() => toDisplayString(company.value.specialInstructions))

const assets = computed(() =>
  company.value.brandAssets.map((asset) => {
    const ext = extractExtension(asset.uri)
    const isImage = ext ? IMAGE_EXTENSIONS.has(ext) : false
    const failed = failedThumbnails.value.has(asset.uri)
    return {
      uri: asset.uri,
      label: asset.label,
      isImage,
      failed
    }
  })
)

function markThumbnailFailed(asset: { uri: string; label: string }) {
  if (failedThumbnails.value.has(asset.uri)) return
  const updated = new Set(failedThumbnails.value)
  updated.add(asset.uri)
  failedThumbnails.value = updated
  notifications.enqueue({
    message: `Preview unavailable for ${asset.label}.`,
    kind: 'warning'
  })
}
</script>

<template>
  <div class="company-info-widget" data-test="company-info-widget">
    <div class="company-header">
      <h3 class="company-name" data-test="company-info-name">
        {{ companyName }}
      </h3>
      <v-btn
        v-if="websiteHref"
        :href="websiteHref"
        target="_blank"
        rel="noopener noreferrer"
        variant="text"
        icon="mdi-web"
        class="company-website"
        size="small"
        data-test="company-info-website"
        :aria-label="`Open ${companyName} website in new tab`"
      />
    </div>

    <div class="company-details">
      <div
        v-for="field in infoFields"
        :key="field.key"
        class="detail-card"
        :data-test="`company-info-field-${field.key}`"
      >
        <span class="detail-label">{{ field.label }}</span>
        <span class="detail-value">
          {{ field.value ?? derivePlaceholderLabel(field.label) }}
        </span>
      </div>
    </div>

    <div class="company-instructions">
      <span class="detail-label">Special Instructions</span>
      <p
        class="instructions-value"
        :class="{ 'instructions-placeholder': !specialInstructions }"
        data-test="company-info-instructions"
      >
        <em v-if="specialInstructions">
          {{ specialInstructions }}
        </em>
        <span v-else>
          {{ derivePlaceholderLabel('Special instructions') }}
        </span>
      </p>
    </div>

    <div class="company-assets">
      <h4 class="section-title">Brand Assets</h4>
      <div v-if="assets.length" class="assets-grid">
        <div
          v-for="asset in assets"
          :key="asset.uri"
          class="asset-card"
          data-test="company-info-asset"
        >
          <div class="asset-thumb">
            <img
              v-if="asset.isImage && !asset.failed"
              :src="asset.uri"
              :alt="`Preview for ${asset.label}`"
              loading="lazy"
              decoding="async"
              data-test="company-info-asset-thumb"
              @error="markThumbnailFailed(asset)"
            />
            <div v-else class="asset-thumb-placeholder" data-test="company-info-asset-placeholder">
              <v-icon :icon="asset.failed ? 'mdi-image-off' : 'mdi-file-outline'" size="20" />
            </div>
          </div>
          <div class="asset-content">
            <div class="asset-label" :title="asset.label">
              {{ asset.label }}
            </div>
            <div class="asset-actions">
              <v-btn
                :href="asset.uri"
                target="_blank"
                rel="noopener noreferrer"
                variant="text"
                icon="mdi-download"
                size="small"
                data-test="company-info-asset-download"
                :aria-label="`Download ${asset.label}`"
              />
            </div>
          </div>
        </div>
      </div>
      <p v-else class="assets-empty" data-test="company-info-assets-empty">
        No brand assets provided.
      </p>
    </div>
  </div>
</template>

<style scoped>
.company-info-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.company-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.company-name {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
}

.company-details {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
}

.detail-card {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.detail-label {
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: rgba(255, 255, 255, 0.6);
}

.detail-value {
  font-size: 0.95rem;
}

.company-instructions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.instructions-value {
  margin: 0;
  font-size: 0.95rem;
}

.instructions-placeholder {
  color: rgba(255, 255, 255, 0.6);
}

.company-assets {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.assets-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}

.asset-card {
  display: flex;
  gap: 12px;
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.02);
  align-items: center;
}

.asset-thumb {
  flex: 0 0 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
}

.asset-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-thumb-placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: rgba(255, 255, 255, 0.6);
}

.asset-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.asset-label {
  font-weight: 500;
  font-size: 0.95rem;
  word-break: break-word;
}

.asset-actions {
  display: flex;
  gap: 4px;
}

.assets-empty {
  margin: 0;
  font-size: 0.95rem;
  color: rgba(255, 255, 255, 0.7);
}
</style>
