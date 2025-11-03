<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useFlexTasksStore, type PostVisualAssetRecord } from '@/stores/flexTasks'
import { resolveFlexAssetSource } from './flexAssetUtils'
import type { FacetWidgetProps, FacetWidgetEmits } from './types'

type VisualAsset = {
  key: string
  assetId: string | null
  url: string
  name: string
  ordering: number
  mimeType: string | null
  meta: Record<string, unknown> | null
}

type ContextAsset = {
  url: string
  assetId: string | null
  ordering: number | null
  name: string | null
  mimeType: string | null
  meta: Record<string, unknown> | null
}

const props = defineProps<FacetWidgetProps>()
const emit = defineEmits<FacetWidgetEmits>()

const flexTasksStore = useFlexTasksStore()

const assets = ref<VisualAsset[]>([])
const uploadError = ref<string | null>(null)
const orderingError = ref<string | null>(null)
const initialLoadError = ref<string | null>(null)
const uploading = ref(false)
const isDragActive = ref(false)
const draggingIndex = ref<number | null>(null)
const outputMode = ref<'string' | 'object'>('string')
const failedThumbnailKeys = ref<Set<string>>(new Set())
let internalUpdate = false

const activeTaskId = computed(() => flexTasksStore.activeTask?.taskId ?? null)
const canEdit = computed(() => Boolean(!props.readonly && activeTaskId.value))

const fileInput = ref<HTMLInputElement | null>(null)

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
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function deriveNameFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const parts = parsed.pathname.split('/')
    return parts[parts.length - 1] || url
  } catch {
    const hashIndex = url.lastIndexOf('#')
    const queryIndex = url.lastIndexOf('?')
    const end = Math.min(...[hashIndex, queryIndex].filter((idx) => idx >= 0))
    const trimmed = end >= 0 ? url.slice(0, end) : url
    const segments = trimmed.split('/')
    return segments[segments.length - 1] || trimmed
  }
}

function normalizeContextAsset(entry: unknown): ContextAsset | null {
  if (typeof entry === 'string') {
    return {
      url: entry,
      assetId: null,
      ordering: null,
      name: deriveNameFromUrl(entry),
      mimeType: null,
      meta: null
    }
  }
  if (!isRecord(entry) || typeof entry.url !== 'string') return null
  return {
    url: entry.url,
    assetId:
      toStringOrNull(entry.assetId) ??
      toStringOrNull(entry.id) ??
      toStringOrNull(entry.asset_id),
    ordering:
      typeof entry.ordering === 'number'
        ? entry.ordering
        : toNumberOrNull(entry.ordering),
    name:
      toStringOrNull(entry.label) ??
      toStringOrNull(entry.title) ??
      toStringOrNull(entry.originalName) ??
      toStringOrNull(entry.filename) ??
      deriveNameFromUrl(entry.url),
    mimeType:
      toStringOrNull(entry.mimeType) ??
      toStringOrNull(entry.contentType) ??
      toStringOrNull(entry.type),
    meta: { ...entry }
  }
}

function extractContextAssets(context: unknown): ContextAsset[] {
  if (!isRecord(context)) return []
  const collections: unknown[] = []
  const pushCandidate = (candidate: unknown) => {
    if (Array.isArray(candidate)) collections.push(candidate)
  }

  pushCandidate(context.post_visual)
  pushCandidate(context.postVisual)
  pushCandidate(context.assets)

  if (isRecord(context.artifacts)) {
    pushCandidate(context.artifacts.post_visual)
  }

  if (isRecord(context.currentOutput)) {
    const currentOutput = context.currentOutput as Record<string, unknown>
    pushCandidate(currentOutput.post_visual)
    if (isRecord(currentOutput.artifacts)) {
      pushCandidate(currentOutput.artifacts.post_visual)
    }
  }

  if (isRecord(context.runContextSnapshot)) {
    const snapshot = context.runContextSnapshot as Record<string, unknown>
    pushCandidate(snapshot.post_visual)
    if (isRecord(snapshot.artifacts)) {
      pushCandidate(snapshot.artifacts.post_visual)
    }
  }

  if (isRecord(context.assetsByFacet)) {
    const byFacet = context.assetsByFacet as Record<string, unknown>
    pushCandidate(byFacet.post_visual)
  }

  const seen = new Set<string>()
  const results: ContextAsset[] = []
  for (const collection of collections) {
    if (!Array.isArray(collection)) continue
    for (const entry of collection) {
      const normalized = normalizeContextAsset(entry)
      if (!normalized || !normalized.url) continue
      if (seen.has(normalized.url)) continue
      seen.add(normalized.url)
      results.push(normalized)
    }
  }
  return results
}

const contextAssets = computed<ContextAsset[]>(() => extractContextAssets(props.taskContext))
const contextAssetMap = computed(() => {
  const map = new Map<string, ContextAsset>()
  for (const asset of contextAssets.value) {
    map.set(asset.url, asset)
  }
  return map
})

function contextAssetToVisual(asset: ContextAsset, fallbackIndex: number): VisualAsset {
  const meta = asset.meta ? { ...asset.meta } : null
  return {
    key: asset.assetId ?? `${fallbackIndex}-${asset.url}`,
    assetId: asset.assetId,
    url: asset.url,
    name: asset.name ?? deriveNameFromUrl(asset.url),
    ordering: asset.ordering ?? fallbackIndex,
    mimeType: asset.mimeType,
    meta
  }
}

function parseModelValue(value: unknown): VisualAsset[] {
  const parsed: VisualAsset[] = []
  let mode: 'string' | 'object' = 'string'

  if (Array.isArray(value) && value.length) {
    value.forEach((entry, index) => {
      if (typeof entry === 'string') {
        const fromContext = contextAssetMap.value.get(entry)
        parsed.push(
          contextAssetToVisual(
            fromContext ?? {
              url: entry,
              assetId: null,
              ordering: index,
              name: deriveNameFromUrl(entry),
              mimeType: null,
              meta: null
            },
            index
          )
        )
      } else if (isRecord(entry) && typeof entry.url === 'string') {
        mode = 'object'
        parsed.push(
          contextAssetToVisual(
            {
              url: entry.url,
              assetId:
                toStringOrNull(entry.assetId) ??
                toStringOrNull(entry.id) ??
                toStringOrNull(entry.asset_id),
              ordering:
                typeof entry.ordering === 'number'
                  ? entry.ordering
                  : toNumberOrNull(entry.ordering),
              name:
                toStringOrNull(entry.label) ??
                toStringOrNull(entry.title) ??
                toStringOrNull(entry.originalName) ??
                toStringOrNull(entry.filename) ??
                deriveNameFromUrl(entry.url),
              mimeType:
                toStringOrNull(entry.mimeType) ??
                toStringOrNull(entry.contentType) ??
                toStringOrNull(entry.type),
              meta: { ...entry }
            },
            index
          )
        )
      }
    })
  }

  if (!parsed.length && contextAssets.value.length) {
    mode = contextAssets.value.some((asset) => !!asset.meta) ? 'object' : 'string'
    contextAssets.value.forEach((asset, index) => {
      parsed.push(contextAssetToVisual(asset, index))
    })
  }

  outputMode.value = mode
  return parsed
}

function normalizeAssets(list: VisualAsset[]): VisualAsset[] {
  return list.map((asset, index) => {
    const nextMeta =
      asset.meta && isRecord(asset.meta)
        ? { ...asset.meta, ordering: index }
        : asset.meta
          ? { ordering: index, url: asset.url, ...asset.meta }
          : outputMode.value === 'object'
            ? { url: asset.url, ordering: index }
            : null
    return {
      ...asset,
      ordering: index,
      meta: nextMeta
    }
  })
}

function pruneFailedThumbnails(list: VisualAsset[]) {
  const allowed = new Set(list.map((asset) => asset.key))
  const filtered = Array.from(failedThumbnailKeys.value).filter((key) => allowed.has(key))
  failedThumbnailKeys.value = new Set(filtered)
}

function setAssets(next: VisualAsset[], options?: { skipEmit?: boolean }) {
  const normalized = normalizeAssets(next)
  assets.value = normalized
  pruneFailedThumbnails(normalized)
  if (!options?.skipEmit) {
    emitUpdate()
  }
}

watch(
  () => props.modelValue,
  (value) => {
    if (internalUpdate) {
      internalUpdate = false
      return
    }
    setAssets(parseModelValue(value), { skipEmit: true })
  },
  { immediate: true, deep: true }
)

watch(
  () => activeTaskId.value,
  (taskId) => {
    if (!taskId) return
    void hydrateRemoteAssets(taskId)
  },
  { immediate: true }
)

function buildFacetValue(): unknown {
  if (outputMode.value === 'object') {
    return assets.value.map((asset) => {
      const payload = asset.meta ? { ...asset.meta } : {}
      ;(payload as Record<string, unknown>).url = asset.url
      if (asset.assetId) {
        (payload as Record<string, unknown>).assetId = asset.assetId
      }
      if (typeof asset.ordering === 'number') {
        (payload as Record<string, unknown>).ordering = asset.ordering
      }
      return payload
    })
  }
  return assets.value.map((asset) => asset.url)
}

function emitUpdate() {
  internalUpdate = true
  emit('update:modelValue', buildFacetValue())
}

const imageExtensions = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'svg',
  'bmp',
  'heic',
  'heif'
])

const nonImageExtensions = new Set([
  'pdf',
  'doc',
  'docx',
  'ppt',
  'pptx',
  'xls',
  'xlsx',
  'csv',
  'zip',
  'rar',
  '7z',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'mp3',
  'wav',
  'txt'
])

function extractExtension(url: string): string | null {
  const withoutParams = url.split(/[?#]/)[0]
  const lastDot = withoutParams.lastIndexOf('.')
  if (lastDot === -1) return null
  return withoutParams.slice(lastDot + 1).toLowerCase()
}

function getMimeType(asset: VisualAsset): string | null {
  if (asset.mimeType && asset.mimeType.trim().length) return asset.mimeType
  if (asset.meta && isRecord(asset.meta)) {
    const meta = asset.meta as Record<string, unknown>
    return (
      toStringOrNull(meta.mime_type) ??
      toStringOrNull(meta.mimeType) ??
      toStringOrNull(meta.content_type) ??
      toStringOrNull(meta.contentType) ??
      toStringOrNull(meta.type)
    )
  }
  return null
}

const nonImageMimePrefixes = ['video/', 'audio/']
const nonImageMimeTypes = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-7z-compressed',
  'application/x-rar-compressed'
])

function isConfidentNonImageAsset(asset: VisualAsset): boolean {
  const mimeType = getMimeType(asset)?.toLowerCase() ?? null
  if (mimeType) {
    if (mimeType.startsWith('image/')) return false
    if (nonImageMimePrefixes.some((prefix) => mimeType.startsWith(prefix))) return true
    if (nonImageMimeTypes.has(mimeType)) return true
  }
  const extension = extractExtension(asset.url)
  if (!extension) return false
  if (imageExtensions.has(extension)) return false
  return nonImageExtensions.has(extension)
}

function canRenderThumbnail(asset: VisualAsset): boolean {
  return !failedThumbnailKeys.value.has(asset.key)
}

function markThumbnailFailed(key: string) {
  const next = new Set(failedThumbnailKeys.value)
  next.add(key)
  failedThumbnailKeys.value = next
}

function getAssetDisplayUrl(asset: VisualAsset): string {
  const { url } = resolveFlexAssetSource({
    assetId: asset.assetId,
    url: asset.url,
    meta: asset.meta && isRecord(asset.meta) ? (asset.meta as Record<string, unknown>) : null
  })
  return url
}

async function hydrateRemoteAssets(taskId: string) {
  try {
    initialLoadError.value = null
    const records = await flexTasksStore.listFlexAssets(taskId, 'post_visual')
    if (!records.length) return
    const mapped = records
      .sort((a, b) => a.ordering - b.ordering)
      .map((record, index) => ({
        key: record.assetId ?? `remote-${index}-${record.url}`,
        assetId: record.assetId,
        url: record.url,
        name: record.originalName ?? deriveNameFromUrl(record.url),
        ordering: typeof record.ordering === 'number' ? record.ordering : index,
        mimeType: record.mimeType ?? null,
        meta:
          outputMode.value === 'object'
            ? {
                url: record.url,
                ordering: typeof record.ordering === 'number' ? record.ordering : index,
                assetId: record.assetId
              }
            : null
      }))
    setAssets(mapped, { skipEmit: true })
  } catch (err: unknown) {
    initialLoadError.value = err instanceof Error ? err.message : 'Failed to load existing assets.'
  }
}

function onDragStart(index: number, event: DragEvent) {
  if (!canEdit.value) return
  draggingIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  event.dataTransfer?.setDragImage(event.currentTarget as Element, 12, 12)
}

function onDragOver(event: DragEvent) {
  if (!canEdit.value) return
  event.preventDefault()
  event.dataTransfer!.dropEffect = 'move'
}

function onDragLeave(event: DragEvent) {
  if (!canEdit.value) return
  if (event.currentTarget === event.target) {
    isDragActive.value = false
  }
}

function onDragEnter(event: DragEvent) {
  if (!canEdit.value) return
  event.preventDefault()
  isDragActive.value = true
}

function onDrop(index: number, event: DragEvent) {
  if (!canEdit.value) return
  event.preventDefault()
  isDragActive.value = false
  const sourceIndex =
    draggingIndex.value ??
    (() => {
      const value = event.dataTransfer?.getData('text/plain')
      return value ? Number.parseInt(value, 10) : NaN
    })()
  if (Number.isNaN(sourceIndex) || sourceIndex === index) {
    draggingIndex.value = null
    return
  }
  moveAsset(sourceIndex, index)
  draggingIndex.value = null
}

function onDragEnd() {
  draggingIndex.value = null
  isDragActive.value = false
}

async function persistOrdering() {
  if (!canEdit.value || !activeTaskId.value) return
  try {
    orderingError.value = null
    await flexTasksStore.updatePostVisualAssetOrdering(
      activeTaskId.value,
      assets.value.map((asset) => ({
        assetId: asset.assetId,
        ordering: asset.ordering
      }))
    )
  } catch (err: unknown) {
    orderingError.value =
      err instanceof Error ? err.message : 'Failed to persist ordering.'
  }
}

function moveAsset(fromIndex: number, toIndex: number) {
  if (!canEdit.value) return
  if (fromIndex < 0 || fromIndex >= assets.value.length) return
  if (toIndex < 0 || toIndex >= assets.value.length) return
  if (fromIndex === toIndex) return
  const next = assets.value.slice()
  const [entry] = next.splice(fromIndex, 1)
  next.splice(toIndex, 0, entry)
  setAssets(next)
  void persistOrdering()
}

async function removeAsset(index: number) {
  if (!canEdit.value || index < 0 || index >= assets.value.length) return
  const asset = assets.value[index]
  const next = assets.value.slice()
  next.splice(index, 1)
  setAssets(next)
  if (asset.assetId && activeTaskId.value) {
    try {
      await flexTasksStore.deletePostVisualAsset(activeTaskId.value, asset.assetId)
      orderingError.value = null
    } catch (err: unknown) {
      orderingError.value = err instanceof Error ? err.message : 'Failed to remove asset.'
      const fallback = assets.value.slice()
      fallback.splice(index, 0, asset)
      setAssets(fallback)
    }
  }
  void persistOrdering()
}

async function handleFiles(files: File[]) {
  if (!canEdit.value || !files.length) return
  if (!activeTaskId.value) {
    uploadError.value = 'Select an active task before uploading assets.'
    return
  }
  uploadError.value = null
  uploading.value = true
  try {
    for (const file of files) {
      let uploaded: PostVisualAssetRecord
      try {
        uploaded = await flexTasksStore.uploadPostVisualAsset(activeTaskId.value, file)
      } catch (err: unknown) {
        uploadError.value = err instanceof Error ? err.message : 'Asset upload failed.'
        continue
      }
      const fallbackMime =
        typeof file.type === 'string' && file.type.trim().length ? file.type : null
      const visual: VisualAsset = {
        key: uploaded.assetId ?? `${Date.now()}-${file.name}`,
        assetId: uploaded.assetId,
        url: uploaded.url,
        name: uploaded.originalName ?? file.name,
        ordering: assets.value.length,
        mimeType: uploaded.mimeType ?? fallbackMime,
        meta:
          outputMode.value === 'object'
            ? {
                url: uploaded.url,
                ordering: assets.value.length,
                assetId: uploaded.assetId ?? undefined
              }
            : { assetId: uploaded.assetId ?? undefined }
      }
      const next = assets.value.concat(visual)
      setAssets(next)
    }
    await persistOrdering()
  } finally {
    uploading.value = false
  }
}

function onFileInputChange(event: Event) {
  if (!canEdit.value) return
  const target = event.target as HTMLInputElement | null
  const list = target?.files ? Array.from(target.files) : []
  if (list.length) {
    void handleFiles(list)
  }
  if (target) {
    target.value = ''
  }
}

function onDropZoneDrop(event: DragEvent) {
  if (!canEdit.value) return
  event.preventDefault()
  isDragActive.value = false
  const files = event.dataTransfer?.files
  if (!files || !files.length) return
  void handleFiles(Array.from(files))
}

function openFilePicker() {
  if (!canEdit.value) return
  fileInput.value?.click()
}

function moveUp(index: number) {
  moveAsset(index, index - 1)
}

function moveDown(index: number) {
  moveAsset(index, index + 1)
}
</script>

<template>
  <div class="post-visual-widget">
    <header class="widget-header">
      <h4 class="widget-title">{{ definition.title }}</h4>
      <p v-if="definition.description" class="widget-description text-body-2 text-medium-emphasis">
        {{ definition.description }}
      </p>
    </header>

    <v-alert
      v-if="definition.semantics && typeof definition.semantics !== 'string' && definition.semantics.instruction"
      type="info"
      variant="tonal"
      border="start"
      class="mb-4"
    >
      {{ definition.semantics.instruction }}
    </v-alert>

    <div
      v-if="canEdit"
      class="drop-zone"
      :class="{ 'drop-zone--active': isDragActive, 'drop-zone--uploading': uploading }"
      data-test="post-visual-dropzone"
      @dragover.prevent="onDragOver"
      @dragenter="onDragEnter"
      @dragleave="onDragLeave"
      @drop="onDropZoneDrop"
    >
      <v-icon icon="mdi-cloud-upload" size="32" class="mb-2" />
      <p class="text-body-2 mb-2">
        Drag and drop visual assets here, or browse your device.
      </p>
      <v-btn
        color="primary"
        variant="outlined"
        :loading="uploading"
        :disabled="uploading"
        @click="openFilePicker"
      >
        Browse files
      </v-btn>
      <input
        ref="fileInput"
        type="file"
        multiple
        class="sr-only"
        data-test="post-visual-file-input"
        @change="onFileInputChange"
      />
    </div>

    <p v-else class="text-body-2 text-medium-emphasis">
      Visual assets are read-only for this assignment.
    </p>

    <v-alert
      v-if="uploadError"
      type="error"
      variant="tonal"
      border="start"
      class="mb-4"
    >
      {{ uploadError }}
    </v-alert>
    <v-alert
      v-if="initialLoadError"
      type="warning"
      variant="tonal"
      border="start"
      class="mb-4"
    >
      {{ initialLoadError }}
    </v-alert>
    <v-alert
      v-if="orderingError"
      type="warning"
      variant="tonal"
      border="start"
      class="mb-4"
    >
      {{ orderingError }}
    </v-alert>

    <div v-if="assets.length" class="asset-list">
      <div
        v-for="(asset, index) in assets"
        :key="asset.key"
        class="asset-row"
        :class="{ 'asset-row--featured': index === 0, 'asset-row--draggable': canEdit }"
        :draggable="canEdit"
        data-test="post-visual-card"
        @dragstart="onDragStart(index, $event)"
        @dragover="onDragOver"
        @dragenter="onDragEnter"
        @drop="onDrop(index, $event)"
        @dragend="onDragEnd"
      >
        <div class="asset-thumb">
          <img
            v-if="canRenderThumbnail(asset)"
            :src="getAssetDisplayUrl(asset)"
            :alt="`Preview of ${asset.name}`"
            class="asset-thumb__image"
            loading="lazy"
            decoding="async"
            data-test="post-visual-thumb"
            @error="markThumbnailFailed(asset.key)"
          />
          <div
            v-else
            class="asset-thumb-placeholder"
            data-test="post-visual-thumb-placeholder"
          >
            <v-icon :icon="isConfidentNonImageAsset(asset) ? 'mdi-file-outline' : 'mdi-image-off'" size="18" />
          </div>
        </div>
        <div class="asset-content">
          <div class="asset-name" :title="asset.name">
            {{ asset.name }}
            <v-chip
              v-if="index === 0"
              size="x-small"
              color="primary"
              variant="outlined"
              class="ms-2"
            >
              Featured
            </v-chip>
          </div>
        </div>
        <div v-if="canEdit" class="asset-controls">
          <v-btn
            icon="mdi-arrow-up"
            size="small"
            variant="text"
            :disabled="index === 0"
            data-test="post-visual-move-up"
            @click="moveUp(index)"
          />
          <v-btn
            icon="mdi-arrow-down"
            size="small"
            variant="text"
            :disabled="index === assets.length - 1"
            data-test="post-visual-move-down"
            @click="moveDown(index)"
          />
          <v-btn
            icon="mdi-delete"
            color="error"
            size="small"
            variant="text"
            data-test="post-visual-remove"
            @click="removeAsset(index)"
          />
        </div>
      </div>
    </div>

    <p v-else class="text-body-2 text-medium-emphasis">
      No visual assets have been added yet.
    </p>
  </div>
</template>

<style scoped>
.post-visual-widget {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.widget-header {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.widget-title {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.drop-zone {
  border: 1px dashed rgba(255, 255, 255, 0.25);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.drop-zone--active {
  border-color: #6ea8fe;
  background-color: rgba(110, 168, 254, 0.08);
}

.drop-zone--uploading {
  opacity: 0.7;
}

.asset-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.asset-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
}

.asset-row--featured {
  border-color: rgba(110, 168, 254, 0.6);
  box-shadow: 0 0 0 1px rgba(110, 168, 254, 0.3);
}

.asset-row--draggable {
  cursor: grab;
}

.asset-row--draggable:active {
  cursor: grabbing;
}

.asset-thumb {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  overflow: hidden;
}

.asset-thumb__image {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.asset-thumb-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: rgba(255, 255, 255, 0.4);
}

.asset-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.asset-name {
  font-size: 0.95rem;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.asset-controls {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
