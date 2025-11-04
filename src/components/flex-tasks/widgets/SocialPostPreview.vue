<script setup lang="ts">
import { computed, watch } from 'vue'
import { resolveFlexAssetSource } from './flexAssetUtils'
import type { FacetWidgetProps, FacetWidgetEmits } from './types'

const props = defineProps<FacetWidgetProps>()
const emit = defineEmits<FacetWidgetEmits>()

type PreviewVisual = {
  key: string
  url: string
  ordering: number
  alt: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (!Number.isNaN(parsed)) {
      return parsed
    }
  }
  return null
}

function extractFacetSnapshotValue(snapshot: Record<string, unknown> | null, key: string): unknown {
  if (!snapshot) return null
  const facets = isRecord(snapshot['facets']) ? (snapshot['facets'] as Record<string, unknown>) : null
  if (!facets) return null
  const entry = facets[key]
  if (isRecord(entry) && 'value' in entry) {
    return (entry as Record<string, unknown>).value
  }
  return entry ?? null
}

function extractCopyFromModel(value: unknown): string | null {
  if (typeof value === 'string') {
    return toStringOrNull(value)
  }
  if (isRecord(value)) {
    return (
      toStringOrNull(value['copy']) ??
      toStringOrNull(value['post_copy']) ??
      null
    )
  }
  return null
}

function extractCopyFromContext(context: Record<string, unknown> | null): string | null {
  if (!context) return null
  const direct = toStringOrNull(context['post_copy'])
  if (direct) return direct

  const designatedPost = isRecord(context['post']) ? (context['post'] as Record<string, unknown>) : null
  const designatedCopy = designatedPost ? toStringOrNull(designatedPost['copy']) : null
  if (designatedCopy) return designatedCopy

  const currentOutput = isRecord(context['currentOutput'])
    ? (context['currentOutput'] as Record<string, unknown>)
    : null
  if (currentOutput) {
    const fromCurrent = toStringOrNull(currentOutput['post_copy'])
    if (fromCurrent) return fromCurrent
    const fromCurrentPost = isRecord(currentOutput['post'])
      ? toStringOrNull((currentOutput['post'] as Record<string, unknown>)['copy'])
      : null
    if (fromCurrentPost) return fromCurrentPost
  }

  const snapshot = isRecord(context['runContextSnapshot'])
    ? (context['runContextSnapshot'] as Record<string, unknown>)
    : null
  if (snapshot) {
    const snapshotCopy = toStringOrNull(extractFacetSnapshotValue(snapshot, 'post_copy'))
    if (snapshotCopy) return snapshotCopy
    const snapshotPost = extractFacetSnapshotValue(snapshot, 'post')
    if (isRecord(snapshotPost)) {
      const fromSnapshotPost = toStringOrNull(snapshotPost['copy'])
      if (fromSnapshotPost) return fromSnapshotPost
    }
  }

  return null
}

function collectCandidateArrays(...values: unknown[]): unknown[] {
  const entries: unknown[] = []
  for (const value of values) {
    if (Array.isArray(value)) {
      entries.push(...value)
    } else if (value !== null && value !== undefined) {
      entries.push(value)
    }
  }
  return entries
}

const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
  'bmp',
  'avif',
  'heic',
  'heif'
])

const NON_IMAGE_EXTENSIONS = new Set([
  'pdf',
  'mp4',
  'mov',
  'm4v',
  'avi',
  'mkv',
  'webm',
  'mp3',
  'wav',
  'aac',
  'flac',
  'ogg',
  'zip',
  'rar',
  '7z',
  'ppt',
  'pptx',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv'
])

function extractExtension(url: string): string | null {
  const trimmed = url.split(/[?#]/)[0] ?? url
  const lastSegment = trimmed.split('/').at(-1) ?? ''
  if (!lastSegment.includes('.')) return null
  const extension = lastSegment.split('.').at(-1)
  return extension ? extension.toLowerCase() : null
}

function extractMetaRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? (value as Record<string, unknown>) : null
}

function looksLikeImage(url: string, meta: Record<string, unknown> | null, explicitMime: string | null): boolean {
  const metaMime = meta
    ? toStringOrNull(meta['mimeType']) ??
      toStringOrNull(meta['contentType']) ??
      toStringOrNull(meta['type'])
    : null
  const candidateMime = (explicitMime ?? metaMime)?.toLowerCase() ?? null
  if (candidateMime) {
    if (candidateMime.startsWith('image/')) return true
    if (
      candidateMime.startsWith('video/') ||
      candidateMime.startsWith('audio/') ||
      candidateMime === 'application/pdf' ||
      candidateMime === 'application/zip'
    ) {
      return false
    }
  }

  const extension = extractExtension(url)?.toLowerCase() ?? null
  if (extension) {
    if (IMAGE_EXTENSIONS.has(extension)) return true
    if (NON_IMAGE_EXTENSIONS.has(extension)) return false
  }

  // Default to rendering when metadata is inconclusive so valid images are not hidden.
  return true
}

function normalizeVisualEntry(entry: unknown, index: number): PreviewVisual | null {
  if (typeof entry === 'string') {
    const trimmed = toStringOrNull(entry)
    if (!trimmed) return null
    const resolved = resolveFlexAssetSource({ assetId: null, url: trimmed, meta: null })
    if (!resolved.url || !looksLikeImage(resolved.url, null, null)) {
      return null
    }
    return {
      key: `${index}-${resolved.url}`,
      url: resolved.url,
      ordering: index,
      alt: 'Social post visual'
    }
  }

  if (!isRecord(entry)) return null

  const url =
    toStringOrNull(entry['url']) ??
    toStringOrNull(entry['href']) ??
    null
  if (!url) return null

  let assetId =
    toStringOrNull(entry['assetId']) ??
    toStringOrNull(entry['id']) ??
    toStringOrNull(entry['asset_id']) ??
    null

  const meta = extractMetaRecord(entry['meta']) ?? null
  const mimeType =
    toStringOrNull(entry['mimeType']) ??
    toStringOrNull(entry['contentType']) ??
    toStringOrNull(entry['type']) ??
    null

  const resolution = resolveFlexAssetSource({ assetId, url, meta })
  if (!resolution.url) {
    return null
  }

  if (resolution.assetId && !assetId) {
    assetId = resolution.assetId
  }

  if (!looksLikeImage(resolution.url, meta, mimeType)) {
    return null
  }

  const ordering = toNumberOrNull(entry['ordering']) ?? index
  const alt =
    toStringOrNull(entry['altText']) ??
    toStringOrNull(entry['label']) ??
    toStringOrNull(entry['name']) ??
    'Social post visual'

  return {
    key: assetId ?? `${ordering}-${resolution.url}`,
    url: resolution.url,
    ordering,
    alt
  }
}

function extractVisualCandidatesFromModel(value: unknown): PreviewVisual[] {
  const candidates: unknown[] = []
  if (Array.isArray(value)) {
    candidates.push(...value)
  } else if (isRecord(value)) {
    if (Array.isArray(value['visuals'])) {
      candidates.push(...(value['visuals'] as unknown[]))
    }
    if (Array.isArray(value['post_visual'])) {
      candidates.push(...(value['post_visual'] as unknown[]))
    }
  }

  const visuals: PreviewVisual[] = []
  candidates.forEach((entry, index) => {
    const normalized = normalizeVisualEntry(entry, index)
    if (normalized) {
      visuals.push(normalized)
    }
  })
  return visuals
}

function extractVisualCandidatesFromContext(context: Record<string, unknown> | null): PreviewVisual[] {
  if (!context) return []

  const currentOutput = isRecord(context['currentOutput'])
    ? (context['currentOutput'] as Record<string, unknown>)
    : null
  const snapshot = isRecord(context['runContextSnapshot'])
    ? (context['runContextSnapshot'] as Record<string, unknown>)
    : null
  const snapshotArtifacts = snapshot && isRecord(snapshot.artifacts)
    ? (snapshot['artifacts'] as Record<string, unknown>)
    : null
  const snapshotAssetsByFacet = snapshot && isRecord(snapshot.assetsByFacet)
    ? (snapshot['assetsByFacet'] as Record<string, unknown>)
    : null

  const candidateCollections = collectCandidateArrays(
    context['post_visual'],
    currentOutput ? currentOutput['post_visual'] : null,
    (() => {
      if (!currentOutput) return null
      const postRecord = isRecord(currentOutput['post'])
        ? (currentOutput['post'] as Record<string, unknown>)
        : null
      if (!postRecord) return null
      return Array.isArray(postRecord['visuals']) ? postRecord['visuals'] : null
    })(),
    extractFacetSnapshotValue(snapshot, 'post_visual'),
    (() => {
      const post = extractFacetSnapshotValue(snapshot, 'post')
      if (isRecord(post) && Array.isArray(post['visuals'])) {
        return post['visuals']
      }
      return null
    })(),
    snapshotArtifacts ? snapshotArtifacts['post_visual'] ?? null : null,
    snapshotAssetsByFacet ? snapshotAssetsByFacet['post_visual'] ?? null : null
  )

  const visuals: PreviewVisual[] = []
  candidateCollections.forEach((entry, index) => {
    const normalized = normalizeVisualEntry(entry, index)
    if (normalized) {
      visuals.push(normalized)
    }
  })
  return visuals
}

const previewCopy = computed(() => {
  return extractCopyFromModel(props.modelValue) ?? extractCopyFromContext(props.taskContext ?? null)
})

const previewVisuals = computed<PreviewVisual[]>(() => {
  const fromModel = extractVisualCandidatesFromModel(props.modelValue)
  const fromContext = extractVisualCandidatesFromContext(props.taskContext ?? null)
  const combined = [...fromModel, ...fromContext]
  if (!combined.length) {
    return []
  }

  combined.sort((a, b) => a.ordering - b.ordering)

  const byUrl = new Map<string, PreviewVisual>()
  for (const entry of combined) {
    if (!entry.url) continue
    if (byUrl.has(entry.url)) continue
    byUrl.set(entry.url, entry)
  }
  return Array.from(byUrl.values())
})

const primaryVisual = computed<PreviewVisual | null>(() => {
  return previewVisuals.value.length ? previewVisuals.value[0] : null
})

const additionalVisuals = computed<PreviewVisual[]>(() => {
  return previewVisuals.value.length > 1 ? previewVisuals.value.slice(1) : []
})

watch(
  () => ({ copy: previewCopy.value, visuals: previewVisuals.value.map((visual) => visual.url) }),
  (value) => {
    if (!value.copy && value.visuals.length === 0) {
      emit('update:modelValue', null)
      return
    }
    emit('update:modelValue', {
      copy: value.copy ?? null,
      visuals: [...value.visuals]
    })
  },
  { immediate: true, deep: true }
)

const panelTitle = computed(() => {
  return toStringOrNull(props.definition?.title) ?? 'Social Post Preview'
})

const hasVisuals = computed(() => previewVisuals.value.length > 0)

const copyFallback = 'Post copy not provided'
const visualsFallback = 'No visuals provided'
</script>

<template>
  <div
    v-if="previewCopy || hasVisuals"
    class="social-post-preview"
    data-test="social-post-preview"
  >
    <v-card
      color="surface"
      variant="flat"
      elevation="0"
      rounded="xl"
      class="social-post-card"
      aria-label="Social post preview"
    >
      <v-card-text class="social-post-content">
        <div class="social-post-body">
          <div class="social-post-copy" data-test="social-post-preview-copy">
            <p v-if="previewCopy" class="copy-text">
              {{ previewCopy }}
            </p>
            <p v-else class="copy-text copy-text--fallback">
              {{ copyFallback }}
            </p>
          </div>

          <div v-if="primaryVisual" class="social-post-visual" data-test="social-post-preview-visual">
            <v-img
              :src="primaryVisual.url"
              :alt="primaryVisual.alt"
              class="social-post-thumbnail"
              width="100%"
              aspect-ratio="1"
              cover
            />
          </div>
          <div v-else class="social-post-no-visuals" data-test="social-post-preview-no-visuals">
            {{ visualsFallback }}
          </div>
        </div>

        <div v-if="additionalVisuals.length" class="social-post-gallery" data-test="social-post-preview-gallery">
          <v-img
            v-for="visual in additionalVisuals"
            :key="`gallery-${visual.key}`"
            :src="visual.url"
            :alt="visual.alt"
            class="social-post-gallery-thumb"
            aspect-ratio="1"
            cover
          />
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>

<style scoped>
.social-post-preview {
  width: 100%;
}

.social-post-card {
  border: 1px solid #d0dcff;
  background-color: #eef4ff !important;
  box-shadow: 0 12px 28px rgba(15, 23, 42, 0.08);
  overflow: hidden;
}

.social-post-content {
  display: flex;
  flex-direction: column;
  gap: 20px;
  padding: 20px 24px;
}

.social-post-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.social-post-copy .copy-text {
  margin: 0;
  white-space: pre-wrap;
  line-height: 1.5;
  color: #1e293b;
}

.copy-text--fallback {
  color: rgba(30, 41, 59, 0.65);
}

.social-post-thumbnail {
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.3);
  overflow: hidden;
}

.social-post-no-visuals {
  color: rgba(30, 41, 59, 0.6);
}

.social-post-gallery {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  gap: 10px;
}

.social-post-gallery-thumb {
  border-radius: 10px;
  border: 1px solid rgba(148, 163, 184, 0.3);
}
</style>
