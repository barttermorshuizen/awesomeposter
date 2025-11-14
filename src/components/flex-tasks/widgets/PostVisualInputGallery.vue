<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FacetWidgetProps } from './types'
import { resolveFlexAssetSource } from './flexAssetUtils'
import {
  useFlexTasksStore,
  type PostVisualAssetRecord,
  type PostVisualInputFacetAssetRecord
} from '@/stores/flexTasks'
import { useNotificationsStore } from '@/stores/notifications'

const props = defineProps<FacetWidgetProps>()

const flexTasksStore = useFlexTasksStore()
const notifications = useNotificationsStore()

const failedThumbnails = ref<Set<string>>(new Set())
const hydrationError = ref<string | null>(null)
const hydratedById = ref<Map<string, PostVisualAssetRecord>>(new Map())
const hydratedByUrl = ref<Map<string, PostVisualAssetRecord>>(new Map())
const isHydrating = ref(false)
const lastHydrationSignature = ref<string | null>(null)

const activeTaskId = computed(() => flexTasksStore.activeTask?.taskId ?? null)

type GalleryAsset = {
  key: string
  assetId: string | null
  url: string
  name: string
  originalName: string | null
  mimeType: string | null
  downloadUrl: string
  isFeatured: boolean
  isManaged: boolean
  isExternal: boolean
  isImage: boolean
  badgeLabel: string | null
  badgeIcon: string
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'bmp', 'heic', 'heif'])
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'avi', 'mkv', 'webm'])
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'aac', 'flac', 'ogg'])
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z'])

function isPostVisualInputFacetAssetRecordList(
  value: unknown
): value is PostVisualInputFacetAssetRecord[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry) =>
        entry &&
        typeof entry === 'object' &&
        'url' in entry &&
        'name' in entry &&
        typeof (entry as Record<string, unknown>).url === 'string'
    )
  )
}

const normalizedAssets = computed<PostVisualInputFacetAssetRecord[]>(() => {
  if (isPostVisualInputFacetAssetRecordList(props.modelValue)) {
    return props.modelValue
  }
  return []
})

function toStringOrNull(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }
  return null
}

function normalizeAssetUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null
  const trimmed = candidate.trim()
  if (!trimmed.length) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.toString()
  } catch {
    return trimmed
  }
}

function extractAssetMeta(asset: PostVisualInputFacetAssetRecord) {
  const meta = asset.meta && typeof asset.meta === 'object' ? (asset.meta as Record<string, unknown>) : null
  const metaAssetId =
    (meta &&
      (toStringOrNull(meta.assetId) ??
        toStringOrNull(meta.id) ??
        toStringOrNull(meta.asset_id))) ??
    null
  const metaUrls = meta
    ? [
        toStringOrNull(meta.url),
        toStringOrNull(meta.href),
        toStringOrNull(meta.sourceUrl),
        toStringOrNull(meta.source_url)
      ]
        .map((entry) => normalizeAssetUrl(entry))
        .filter((entry): entry is string => Boolean(entry))
    : []
  const previewCandidate =
    (meta &&
      (toStringOrNull(meta.previewUrl) ??
        toStringOrNull(meta.preview_url) ??
        toStringOrNull(meta.thumbnailUrl) ??
        toStringOrNull(meta.thumbnail_url))) ??
    null
  return { meta, metaAssetId, metaUrls, previewCandidate }
}

function lastPathSegment(path: string): string {
  const segments = path.split('/').filter((segment) => segment.length > 0)
  if (!segments.length) return ''
  return segments[segments.length - 1] ?? ''
}

function findManagedRecord(
  asset: PostVisualInputFacetAssetRecord,
  metaAssetId: string | null,
  metaUrls: string[]
): PostVisualAssetRecord | null {
  const idCandidates = [asset.assetId, metaAssetId]
    .map((value) => toStringOrNull(value))
    .filter((value): value is string => Boolean(value))

  for (const id of idCandidates) {
    const record = hydratedById.value.get(id)
    if (record) return record
  }

  const urlCandidates = [
    normalizeAssetUrl(asset.url),
    ...metaUrls
  ].filter((value): value is string => Boolean(value))

  for (const url of urlCandidates) {
    const record = hydratedByUrl.value.get(url)
    if (record) return record
  }

  return null
}

function extractExtension(url: string): string | null {
  const cleaned = url.split(/[?#]/)[0] ?? url
  const lastSegment = lastPathSegment(cleaned)
  if (!lastSegment.includes('.')) return null
  const parts = lastSegment.split('.')
  const ext = parts.length ? parts[parts.length - 1] : null
  return ext ? ext.toLowerCase() : null
}

function resolveBadge(
  mimeType: string | null,
  extension: string | null
): { isImage: boolean; label: string | null; icon: string } {
  const normalizedMime = mimeType?.toLowerCase() ?? null
  const normalizedExtension = extension?.toLowerCase() ?? null

  if (
    (normalizedMime && normalizedMime.startsWith('image/')) ||
    (normalizedExtension && IMAGE_EXTENSIONS.has(normalizedExtension))
  ) {
    return { isImage: true, label: null, icon: 'mdi-image-outline' }
  }

  if (
    (normalizedMime && normalizedMime.startsWith('video/')) ||
    (normalizedExtension && VIDEO_EXTENSIONS.has(normalizedExtension))
  ) {
    return { isImage: false, label: 'Video', icon: 'mdi-video-outline' }
  }

  if (
    (normalizedMime && normalizedMime.startsWith('audio/')) ||
    (normalizedExtension && AUDIO_EXTENSIONS.has(normalizedExtension))
  ) {
    return { isImage: false, label: 'Audio', icon: 'mdi-music-note-outline' }
  }

  if (normalizedMime === 'application/pdf' || normalizedExtension === 'pdf') {
    return { isImage: false, label: 'PDF', icon: 'mdi-file-pdf-box' }
  }

  if (
    (normalizedMime && normalizedMime.includes('presentation')) ||
    (normalizedExtension && (normalizedExtension === 'ppt' || normalizedExtension === 'pptx'))
  ) {
    return { isImage: false, label: 'Slides', icon: 'mdi-file-powerpoint-box' }
  }

  if (
    (normalizedMime && normalizedMime.includes('spreadsheet')) ||
    (normalizedExtension && ['xls', 'xlsx', 'csv'].includes(normalizedExtension))
  ) {
    return { isImage: false, label: 'Sheet', icon: 'mdi-file-excel-box' }
  }

  if (
    (normalizedMime && normalizedMime.includes('msword')) ||
    (normalizedExtension && (normalizedExtension === 'doc' || normalizedExtension === 'docx'))
  ) {
    return { isImage: false, label: 'Doc', icon: 'mdi-file-word-box' }
  }

  if (normalizedExtension && ARCHIVE_EXTENSIONS.has(normalizedExtension)) {
    return { isImage: false, label: 'Archive', icon: 'mdi-archive-outline' }
  }

  return { isImage: false, label: 'File', icon: 'mdi-file-outline' }
}

function buildGalleryAssets(): GalleryAsset[] {
  return normalizedAssets.value.map((asset, index) => {
    const { meta, metaAssetId, metaUrls } = extractAssetMeta(asset)
    const managedRecord = findManagedRecord(asset, metaAssetId, metaUrls)
    const descriptor = {
      assetId:
        toStringOrNull(asset.assetId) ??
        metaAssetId ??
        (managedRecord?.assetId ? toStringOrNull(managedRecord.assetId) : null),
      url: managedRecord?.url ?? asset.url,
      meta
    }
    let resolution = resolveFlexAssetSource(descriptor)
    if (!resolution.assetId) {
      const normalizedResolutionUrl = normalizeAssetUrl(resolution.url)
      if (normalizedResolutionUrl) {
        const matchedRecord = hydratedByUrl.value.get(normalizedResolutionUrl)
        if (matchedRecord?.assetId) {
          resolution = {
            assetId: matchedRecord.assetId,
            url: `/api/flex/assets/${encodeURIComponent(matchedRecord.assetId)}/download`
          }
        }
      }
    }
    const mimeType = managedRecord?.mimeType ?? asset.mimeType ?? null
    const extension = extractExtension(managedRecord?.url ?? asset.url)
    const badge = resolveBadge(mimeType, extension)
    const displayName =
      toStringOrNull(asset.originalName) ??
      toStringOrNull(managedRecord?.originalName) ??
      toStringOrNull(managedRecord?.filename) ??
      (meta ? toStringOrNull(meta.originalName) ?? toStringOrNull(meta.original_name) : null) ??
      toStringOrNull(managedRecord?.filename) ??
      toStringOrNull(asset.name) ??
      (extension ? `${extension.toUpperCase()} asset` : 'Visual asset')
    const key =
      asset.key ??
      (resolution.assetId
        ? `id::${resolution.assetId}`
        : resolution.url.length
          ? `url::${resolution.url}`
          : `${asset.url}::${index}`)
    return {
      key,
      assetId: resolution.assetId,
      url: asset.url,
      name: displayName,
      originalName: asset.originalName ?? managedRecord?.originalName ?? null,
      mimeType,
      downloadUrl: resolution.url,
      isFeatured: index === 0,
      isManaged: Boolean(resolution.assetId),
      isExternal: !resolution.assetId,
      isImage:
        badge.isImage &&
        resolution.url.length > 0 &&
        !failedThumbnails.value.has(key),
      badgeLabel: badge.label,
      badgeIcon: badge.icon
    }
  })
}

const galleryAssets = ref<GalleryAsset[]>([])

function refreshGalleryAssets() {
  galleryAssets.value = buildGalleryAssets()
}

watch(
  () => [
    normalizedAssets.value,
    hydratedById.value,
    hydratedByUrl.value,
    failedThumbnails.value
  ],
  refreshGalleryAssets,
  { deep: true }
)

refreshGalleryAssets()

watch(
  () => galleryAssets.value,
  (list) => {
    const allowed = new Set(list.map((asset) => asset.key))
    const current = failedThumbnails.value
    const filtered = new Set(Array.from(current).filter((key) => allowed.has(key)))
    if (filtered.size !== current.size) {
      failedThumbnails.value = filtered
    }
  },
  { deep: true }
)

async function hydrateManagedAssets(taskId: string) {
  const signature = `${taskId}::${normalizedAssets.value
    .map((asset, index) => {
      const { metaAssetId, metaUrls } = extractAssetMeta(asset)
      return (
        toStringOrNull(asset.assetId) ??
        metaAssetId ??
        normalizeAssetUrl(asset.url) ??
        metaUrls[0] ??
        `idx:${index}`
      )
  })
    .sort()
    .join('|')}`
  if (!normalizedAssets.value.length) {
    hydrationError.value = null
    hydratedById.value = new Map()
    hydratedByUrl.value = new Map()
    lastHydrationSignature.value = signature
    return
  }
  if (
    signature === lastHydrationSignature.value &&
    hydratedById.value.size &&
    !hydrationError.value
  ) {
    return
  }
  lastHydrationSignature.value = signature

  isHydrating.value = true
  hydrationError.value = null
  try {
    const records = await flexTasksStore.listFlexAssets(taskId, 'post_visual')
    const byId = new Map<string, PostVisualAssetRecord>()
    const byUrl = new Map<string, PostVisualAssetRecord>()
    records.forEach((record) => {
      if (record.assetId) {
        byId.set(record.assetId, record)
      }
      const normalizedUrl = normalizeAssetUrl(record.url)
      if (normalizedUrl) {
        byUrl.set(normalizedUrl, record)
      }
    })
    hydratedById.value = byId
    hydratedByUrl.value = byUrl
    refreshGalleryAssets()
  } catch (error: unknown) {
    hydrationError.value =
      error instanceof Error ? error.message : 'Unable to hydrate managed visual assets.'
    lastHydrationSignature.value = null
  } finally {
    isHydrating.value = false
  }
}

watch(
  () => ({
    taskId: activeTaskId.value,
    assetsSignature: normalizedAssets.value
      .map((asset) => asset.assetId ?? asset.url)
      .sort()
      .join('|')
  }),
  ({ taskId }) => {
    if (taskId) {
      void hydrateManagedAssets(taskId)
    } else {
      hydratedById.value = new Map()
      hydratedByUrl.value = new Map()
      hydrationError.value = null
      lastHydrationSignature.value = null
      refreshGalleryAssets()
    }
  },
  { immediate: true }
)

function markThumbnailFailure(asset: GalleryAsset) {
  if (failedThumbnails.value.has(asset.key)) return
  const next = new Set(failedThumbnails.value)
  next.add(asset.key)
  failedThumbnails.value = next
  notifications.enqueue({
    message: `Preview unavailable for ${asset.name}.`,
    kind: 'warning'
  })
}
</script>

<template>
  <section class="post-visual-input" data-test="post-visual-input-gallery">
    <header class="gallery-header">
      <p
        v-if="definition.description"
        class="gallery-description text-body-2 text-medium-emphasis"
      >
        {{ definition.description }}
      </p>
    </header>

    <v-alert
      v-if="hydrationError"
      type="warning"
      variant="tonal"
      border="start"
      class="mb-4"
      data-test="post-visual-input-alert"
    >
      {{ hydrationError }}
    </v-alert>

    <v-progress-linear
      v-if="isHydrating"
      indeterminate
      color="primary"
      class="mb-4"
      data-test="post-visual-input-loading"
    />

    <div v-if="galleryAssets.length" class="gallery-grid">
      <article
        v-for="asset in galleryAssets"
        :key="asset.key"
        class="gallery-card"
        :aria-label="`${asset.name}${asset.isFeatured ? ' (Featured)' : ''}`"
        data-test="post-visual-input-card"
      >
        <div class="card-media">
          <img
            v-if="asset.isImage"
            :src="asset.downloadUrl"
            :alt="`Preview of ${asset.name}`"
            loading="lazy"
            decoding="async"
            @error="markThumbnailFailure(asset)"
            data-test="post-visual-input-thumb"
          />
          <div v-else class="card-media__placeholder" data-test="post-visual-input-placeholder">
            <v-icon :icon="asset.badgeIcon" size="32" />
          </div>
          <v-chip
            v-if="asset.isFeatured"
            size="small"
            color="primary"
            label
            class="featured-chip"
            data-test="post-visual-input-featured"
          >
            Featured
          </v-chip>
        </div>
        <div class="card-body">
          <div class="card-title" :title="asset.name">
            <span class="asset-name">{{ asset.name }}</span>
          </div>
          <div class="card-meta">
            <v-chip
              v-if="asset.badgeLabel"
              size="x-small"
              variant="outlined"
              class="mr-2"
              data-test="post-visual-input-badge"
            >
              {{ asset.badgeLabel }}
            </v-chip>
            <span v-if="asset.isExternal" class="asset-source text-caption text-medium-emphasis">
              External link
            </span>
            <span v-else class="asset-source text-caption text-medium-emphasis">
              Flex asset
            </span>
          </div>
          <div class="card-actions">
            <v-btn
              variant="text"
              color="primary"
              :href="asset.downloadUrl"
              target="_blank"
              rel="noopener noreferrer"
              :aria-label="`Open ${asset.name} in new tab`"
              prepend-icon="mdi-open-in-new"
              data-test="post-visual-input-download"
            >
              View asset
            </v-btn>
          </div>
        </div>
      </article>
    </div>
    <p
      v-else
      class="gallery-empty text-body-2 text-medium-emphasis"
      data-test="post-visual-input-empty"
    >
      No visual assets supplied for this assignment.
    </p>
  </section>
</template>

<style scoped>
.post-visual-input {
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.gallery-header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.gallery-title {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.gallery-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}

.gallery-card {
  border: 1px solid rgba(var(--v-border-color), 0.24);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--v-shadow-2);
}

.card-media {
  position: relative;
  aspect-ratio: 4 / 3;
  background: rgb(var(--v-theme-surface-variant));
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-media img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-media__placeholder {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(var(--v-theme-surface-variant), 0.6);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.featured-chip {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  font-weight: 600;
}

.card-body {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem 1rem 1rem;
}

.card-title {
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.asset-name {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.card-actions {
  display: flex;
  justify-content: flex-start;
}

.gallery-empty {
  margin: 0;
}
</style>
