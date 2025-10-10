import { z, ZodError, type ZodIssue } from 'zod'
import type { DiscoverySourceType } from '../discovery.js'

export const DEFAULT_WEB_LIST_MAX_DEPTH = 5

const trimmedString = z.string().trim().min(1)
const regexFlagsPattern = /^[gimsuy]*$/

const rawValueTransformSchema = z.object({
  pattern: trimmedString,
  flags: z.string().regex(regexFlagsPattern, { message: 'Invalid regex flags supplied for value transform' }).optional(),
  replacement: z.string().optional(),
}).strict().superRefine((value, ctx) => {
  try {
    // Ensure the pattern compiles with the provided flags
    // eslint-disable-next-line no-new
    new RegExp(value.pattern, value.flags)
  } catch (error) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pattern'],
      message: error instanceof Error ? error.message : 'Invalid regex pattern',
    })
  }
})

type RawValueTransform = z.infer<typeof rawValueTransformSchema>

export type RegexValueTransform = {
  pattern: string
  flags?: string
  replacement?: string
}

export type ValueTransformMigrationResult = {
  transform: RegexValueTransform | null
  warnings: string[]
}

const LEGACY_VALUE_PLACEHOLDER = /\{\{\s*value\s*\}\}/g
const UNSUPPORTED_LEGACY_PLACEHOLDER = /\{\{\s*(?!\s*value\b)[^}]+\}\}/

export function convertLegacyValueTemplate(template: string): ValueTransformMigrationResult {
  const trimmedTemplate = template.trim()
  if (!trimmedTemplate) {
    return {
      transform: null,
      warnings: ['Legacy value template is empty after trimming'],
    }
  }

  const warnings: string[] = []
  if (UNSUPPORTED_LEGACY_PLACEHOLDER.test(trimmedTemplate)) {
    warnings.push('Legacy value template contains unsupported placeholders and may need manual review')
  }

  const escaped = trimmedTemplate.replace(/\$/g, '$$$$')
  const containsMoustache = trimmedTemplate.includes('{{')
  const hasPlaceholder = /\{\{\s*value\s*\}\}/.test(trimmedTemplate)
  const replacement = hasPlaceholder
    ? escaped.replace(LEGACY_VALUE_PLACEHOLDER, '$1')
    : containsMoustache
      ? escaped
      : `${escaped}$1`

  return {
    transform: {
      pattern: '^(.*)$',
      replacement,
    },
    warnings,
  }
}

const numericDepthSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value.trim(), 10)
    return Number.isFinite(parsed) ? parsed : value
  }
  return value
}, z.number().int().min(1).max(20).optional())

const rawSelectorSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return { selector: value }
  }
  if (value && typeof value === 'object') {
    return value
  }
  return value
}, z.object({
  selector: trimmedString,
  attribute: trimmedString.optional(),
  valueTemplate: trimmedString.optional(),
  valueTransform: rawValueTransformSchema.optional(),
  legacyValueTemplate: trimmedString.optional(),
  valueTransformWarnings: z.array(trimmedString).optional(),
}).strict().passthrough())

type RawSelector = z.infer<typeof rawSelectorSchema>

export type DiscoverySourceWebListSelector = {
  selector: string
  attribute?: string
  valueTransform?: RegexValueTransform
  legacyValueTemplate?: string
  valueTransformWarnings?: string[]
} & Record<string, unknown>

function normalizeValueTransform(raw: RawValueTransform | undefined | null): RegexValueTransform | null {
  if (!raw) {
    return null
  }
  const normalized: RegexValueTransform = {
    pattern: raw.pattern.trim(),
  }
  const flags = raw.flags?.trim()
  if (flags) {
    normalized.flags = flags
  }
  if (raw.replacement !== undefined) {
    normalized.replacement = raw.replacement
  }
  return normalized
}

function normalizeSelector(raw: RawSelector): DiscoverySourceWebListSelector {
  const {
    selector,
    attribute,
    valueTemplate,
    valueTransform,
    ...rest
  } = raw as RawSelector & { valueTransform?: RawValueTransform }
  const normalized: DiscoverySourceWebListSelector = {
    selector,
    ...rest,
  }
  if (attribute) {
    normalized.attribute = attribute
  }
  if (valueTransform) {
    const normalizedTransform = normalizeValueTransform(valueTransform)
    if (normalizedTransform) {
      normalized.valueTransform = normalizedTransform
    }
  } else if (valueTemplate) {
    const migration = convertLegacyValueTemplate(valueTemplate)
    if (migration.transform) {
      normalized.valueTransform = migration.transform
    }
    normalized.legacyValueTemplate = valueTemplate
    if (migration.warnings.length) {
      normalized.valueTransformWarnings = [
        ...(normalized.valueTransformWarnings ?? []),
        ...migration.warnings,
      ]
    }
  }
  return normalized
}

function denormalizeSelector(selector: DiscoverySourceWebListSelector): RawSelector {
  const {
    selector: value,
    attribute,
    valueTransform,
    legacyValueTemplate,
    valueTransformWarnings,
    ...rest
  } = selector
  const payload: RawSelector = {
    selector: value.trim(),
    ...rest,
  }
  if (attribute) {
    payload.attribute = attribute.trim()
  }
  if (valueTransform) {
    const transformed: RawValueTransform = {
      pattern: valueTransform.pattern.trim(),
    }
    if (valueTransform.flags?.trim()) {
      transformed.flags = valueTransform.flags.trim()
    }
    if (valueTransform.replacement !== undefined) {
      transformed.replacement = valueTransform.replacement
    }
    payload.valueTransform = transformed
  }
  if (legacyValueTemplate) {
    payload.legacyValueTemplate = legacyValueTemplate
  }
  if (valueTransformWarnings?.length) {
    payload.valueTransformWarnings = [...valueTransformWarnings]
  }
  return payload
}

const rawWebListFieldsSchema = z.object({
  title: rawSelectorSchema.optional(),
  excerpt: rawSelectorSchema.optional(),
  url: rawSelectorSchema.optional(),
  timestamp: rawSelectorSchema.optional(),
}).partial().default({})

type RawWebListFields = z.infer<typeof rawWebListFieldsSchema>

const rawPaginationSchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === false) {
    return undefined
  }
  if (typeof value === 'string') {
    return { next_page: value }
  }
  if (typeof value === 'object') {
    return value
  }
  return value
}, z.object({
  next_page: rawSelectorSchema,
  max_depth: numericDepthSchema,
}).strict().passthrough()).transform((value) => ({
  next_page: value.next_page,
  max_depth: value.max_depth ?? DEFAULT_WEB_LIST_MAX_DEPTH,
}))

type RawWebListPagination = z.infer<typeof rawPaginationSchema>

const rawWebListConfigSchema = z.object({
  list_container_selector: trimmedString,
  item_selector: trimmedString,
  fields: rawWebListFieldsSchema.optional(),
  pagination: rawPaginationSchema.optional(),
}).strict().passthrough()

type RawWebListConfig = z.infer<typeof rawWebListConfigSchema>

export type DiscoverySourceWebListFieldMap = {
  title?: DiscoverySourceWebListSelector
  excerpt?: DiscoverySourceWebListSelector
  url?: DiscoverySourceWebListSelector
  timestamp?: DiscoverySourceWebListSelector
} & Record<string, unknown>

export type DiscoverySourceWebListConfig = {
  listContainerSelector: string
  itemSelector: string
  fields?: DiscoverySourceWebListFieldMap
  pagination?: {
    nextPage: DiscoverySourceWebListSelector
    maxDepth: number
  }
} & Record<string, unknown>

function normalizeWebListFields(fields: RawWebListFields | undefined): DiscoverySourceWebListFieldMap {
  if (!fields) {
    return {}
  }
  const { title, excerpt, url, timestamp, ...rest } = fields
  const normalized: DiscoverySourceWebListFieldMap = { ...rest }
  if (title) {
    normalized.title = normalizeSelector(title)
  }
  if (excerpt) {
    normalized.excerpt = normalizeSelector(excerpt)
  }
  if (url) {
    normalized.url = normalizeSelector(url)
  }
  if (timestamp) {
    normalized.timestamp = normalizeSelector(timestamp)
  }
  return normalized
}

function denormalizeWebListFields(fields: DiscoverySourceWebListFieldMap): RawWebListFields | undefined {
  if (!fields) {
    return undefined
  }
  const { title, excerpt, url, timestamp, ...rest } = fields
  const payload: RawWebListFields = { ...rest }
  if (title) {
    payload.title = denormalizeSelector(title)
  }
  if (excerpt) {
    payload.excerpt = denormalizeSelector(excerpt)
  }
  if (url) {
    payload.url = denormalizeSelector(url)
  }
  if (timestamp) {
    payload.timestamp = denormalizeSelector(timestamp)
  }
  return Object.keys(payload).length ? payload : undefined
}

function normalizeWebListConfig(raw: RawWebListConfig): DiscoverySourceWebListConfig {
  const {
    list_container_selector,
    item_selector,
    fields,
    pagination,
    ...rest
  } = raw
  const normalized: DiscoverySourceWebListConfig = {
    listContainerSelector: list_container_selector,
    itemSelector: item_selector,
    ...rest,
  }
  const normalizedFields = normalizeWebListFields(fields)
  if (Object.keys(normalizedFields).length > 0) {
    normalized.fields = normalizedFields
  } else {
    normalized.fields = {}
  }
  if (pagination) {
    normalized.pagination = {
      nextPage: normalizeSelector(pagination.next_page),
      maxDepth: pagination.max_depth,
    }
  }
  return normalized
}

function denormalizeWebListConfig(config: DiscoverySourceWebListConfig): RawWebListConfig {
  const {
    listContainerSelector,
    itemSelector,
    fields,
    pagination,
    ...rest
  } = config
  const payload: RawWebListConfig = {
    list_container_selector: listContainerSelector.trim(),
    item_selector: itemSelector.trim(),
    ...rest,
  }
  const serializedFields = fields ? denormalizeWebListFields(fields) : undefined
  if (serializedFields && Object.keys(serializedFields).length) {
    payload.fields = serializedFields
  }
  if (pagination) {
    payload.pagination = {
      next_page: denormalizeSelector(pagination.nextPage),
      max_depth: pagination.maxDepth,
    }
  }
  return payload
}

export type DiscoverySourceYoutubeConfig = {
  channel?: string
  playlist?: string
} & Record<string, unknown>

const rawYoutubeConfigSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'object') {
    return value
  }
  return value
}, z.object({
  channel: trimmedString.optional(),
  channelId: trimmedString.optional(),
  playlist: trimmedString.optional(),
  playlistId: trimmedString.optional(),
}).partial().passthrough()).transform((value) => {
  const { channel, channelId, playlist, playlistId, ...rest } = value
  const normalized: DiscoverySourceYoutubeConfig = { ...rest }
  if (channel ?? channelId) {
    normalized.channel = (channel ?? channelId)!.trim()
  }
  if (playlist ?? playlistId) {
    normalized.playlist = (playlist ?? playlistId)!.trim()
  }
  return normalized
})

export type DiscoverySourceRssConfig = {
  canonical?: boolean
} & Record<string, unknown>

const rawRssConfigSchema = z.preprocess((value) => {
  if (value === undefined || value === null) {
    return undefined
  }
  if (typeof value === 'object') {
    return value
  }
  return value
}, z.object({
  canonical: z.boolean().optional(),
}).partial().passthrough()).transform((value) => {
  const { canonical, ...rest } = value
  const normalized: DiscoverySourceRssConfig = { ...rest }
  if (typeof canonical === 'boolean') {
    normalized.canonical = canonical
  }
  return normalized
})

const rawDiscoverySourceConfigSchema = z.object({
  youtube: rawYoutubeConfigSchema.optional(),
  rss: rawRssConfigSchema.optional(),
  webList: rawWebListConfigSchema.optional(),
}).partial().passthrough()

type RawDiscoverySourceConfig = z.infer<typeof rawDiscoverySourceConfigSchema>

export type DiscoverySourceConfig = {
  youtube?: DiscoverySourceYoutubeConfig
  rss?: DiscoverySourceRssConfig
  webList?: DiscoverySourceWebListConfig
} & Record<string, unknown>

function normalizeDiscoverySourceConfig(raw: RawDiscoverySourceConfig): DiscoverySourceConfig {
  const { youtube, rss, webList, ...rest } = raw
  const config: DiscoverySourceConfig = { ...rest }
  if (youtube && Object.keys(youtube).length > 0) {
    config.youtube = youtube
  }
  if (rss && Object.keys(rss).length > 0) {
    config.rss = rss
  }
  if (webList) {
    config.webList = normalizeWebListConfig(webList)
  }
  return config
}

export type DiscoverySourceConfigParseSuccess = {
  ok: true
  config: DiscoverySourceConfig
}

export type DiscoverySourceConfigParseFailure = {
  ok: false
  issues: ZodIssue[]
  error: ZodError<unknown>
}

export type DiscoverySourceConfigParseResult =
  | DiscoverySourceConfigParseSuccess
  | DiscoverySourceConfigParseFailure

export const discoverySourceConfigInputSchema = rawDiscoverySourceConfigSchema
export const discoverySourceWebListConfigInputSchema = rawWebListConfigSchema

export function safeParseDiscoverySourceConfig(raw: unknown): DiscoverySourceConfigParseResult {
  if (raw === undefined || raw === null) {
    return { ok: true, config: {} as DiscoverySourceConfig }
  }
  let candidate: unknown = raw
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate)
    } catch (error) {
      const issue: ZodIssue = {
        code: 'custom',
        message: 'Invalid JSON string provided for discovery source configuration',
        path: [],
        params: { error: (error as Error).message },
      }
      return { ok: false, issues: [issue], error: new ZodError([issue]) }
    }
  }
  const result = rawDiscoverySourceConfigSchema.safeParse(candidate)
  if (!result.success) {
    return { ok: false, issues: result.error.issues, error: result.error }
  }
  return { ok: true, config: normalizeDiscoverySourceConfig(result.data) }
}

export function parseDiscoverySourceConfig(raw: unknown): DiscoverySourceConfig {
  const result = safeParseDiscoverySourceConfig(raw)
  if (!result.ok) {
    throw result.error
  }
  return result.config
}

export function serializeDiscoverySourceConfig(
  config: DiscoverySourceConfig | null | undefined,
): Record<string, unknown> | null {
  if (!config) {
    return null
  }
  const { youtube, rss, webList, ...rest } = config
  const payload: Record<string, unknown> = { ...rest }

  if (youtube && Object.keys(youtube).length > 0) {
    const { channel, playlist, ...youtubeRest } = youtube
    const youtubePayload: Record<string, unknown> = { ...youtubeRest }
    if (typeof channel === 'string' && channel.trim()) {
      youtubePayload.channel = channel.trim()
    }
    if (typeof playlist === 'string' && playlist.trim()) {
      youtubePayload.playlist = playlist.trim()
    }
    if (Object.keys(youtubePayload).length > 0) {
      payload.youtube = youtubePayload
    }
  }

  if (rss && Object.keys(rss).length > 0) {
    const { canonical, ...rssRest } = rss
    const rssPayload: Record<string, unknown> = { ...rssRest }
    if (typeof canonical === 'boolean') {
      rssPayload.canonical = canonical
    }
    if (Object.keys(rssPayload).length > 0) {
      payload.rss = rssPayload
    }
  }

  if (webList) {
    payload.webList = denormalizeWebListConfig(webList)
  }

  return Object.keys(payload).length > 0 ? payload : null
}

export function createDefaultConfigForSource(
  type: DiscoverySourceType,
  identifier: string,
): Record<string, unknown> | null {
  const trimmedIdentifier = identifier.trim()
  switch (type) {
    case 'youtube-channel':
      return serializeDiscoverySourceConfig({
        youtube: { channel: trimmedIdentifier },
      })
    case 'youtube-playlist':
      return serializeDiscoverySourceConfig({
        youtube: { playlist: trimmedIdentifier },
      })
    case 'rss':
      return serializeDiscoverySourceConfig({
        rss: { canonical: true },
      })
    default:
      return null
  }
}

export function hasWebListConfig(config: DiscoverySourceConfig | null | undefined): boolean {
  return Boolean(config?.webList)
}

export type DiscoveryWebListPreviewItem = {
  title?: string | null
  url?: string | null
  excerpt?: string | null
  timestamp?: string | null
} & Record<string, unknown>

export type DiscoveryWebListPreviewResult = {
  item: DiscoveryWebListPreviewItem | null
  warnings: string[]
  fetchedAt: string
}
