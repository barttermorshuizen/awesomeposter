import { load, type CheerioAPI, type Cheerio } from 'cheerio'
import type { Element } from 'domhandler'
import type {
  DiscoveryIngestionAdapter,
  DiscoveryAdapterResult,
  NormalizedDiscoveryItemEnvelope,
} from '../ingestion.js'
import type {
  DiscoveryIngestionFailureReason,
  DiscoveryPublishedAtSource,
} from '../../discovery.js'
import {
  normalizedDiscoveryAdapterItemSchema,
  type ArticleSourceMetadata,
} from '../../discovery.js'
import type {
  DiscoverySourceWebListConfig,
  DiscoverySourceWebListSelector,
} from '../config.js'
import {
  sanitizeHtmlContent,
  createExcerpt,
  extractMetaContent,
  derivePublishedAt,
  normalizeTitle,
} from '../normalization.js'

type PublishedAtResolution = {
  publishedAt: string
  source: DiscoveryPublishedAtSource
  invalid?: string
}

type WebListExtractionResult = {
  applied: boolean
  items: NormalizedDiscoveryItemEnvelope[]
  metadata: Record<string, unknown>
}

type ValueTransformStats = {
  applied: number
  misses: number
}

type FieldTransformState = 'applied' | 'missed' | 'none'

type FieldTransformTelemetry = Partial<Record<'title' | 'excerpt' | 'url' | 'timestamp', FieldTransformState>>

type BuildListItemContext = {
  $: CheerioAPI
  element: Element
  index: number
  config: DiscoverySourceWebListConfig
  baseUrl: string
  nowIso: string
  transformStats: ValueTransformStats
}

type BuildListItemSuccess = {
  ok: true
  item: NormalizedDiscoveryItemEnvelope
  urlKey: string | null
}

type BuildListItemFailure = {
  ok: false
  reason: string
  details?: Record<string, unknown>
}

type BuildListItemResult = BuildListItemSuccess | BuildListItemFailure

type ConfiguredFieldMap = Partial<Record<'title' | 'excerpt' | 'url' | 'timestamp', string>>

const SUPPORTED_URL_PROTOCOLS = new Set(['http:', 'https:'])
const MAX_LIST_ITEMS = 100
const KNOWN_WEB_LIST_FIELDS = new Set(['title', 'excerpt', 'url', 'timestamp'])

function resolveFailureReason(responseStatus: number): DiscoveryIngestionFailureReason {
  if (responseStatus >= 500) return 'http_5xx'
  if (responseStatus >= 400) return 'http_4xx'
  return 'unknown_error'
}

function extractListItems(
  html: string,
  config: DiscoverySourceWebListConfig,
  baseUrl: string,
  now: Date,
): WebListExtractionResult {
  const $ = load(html)
  const metadata: Record<string, unknown> = {
    webListConfigured: true,
   webListAttempted: true,
    webListApplied: false,
    listItemCount: 0,
    paginationDepth: 1,
    valueTransformApplied: 0,
    valueTransformMisses: 0,
  }
  const issues: Array<Record<string, unknown>> = []
  const skipped: Array<Record<string, unknown>> = []

  const container = $(config.listContainerSelector).first()
  if (!container.length) {
    issues.push({
      reason: 'list_container_not_found',
      selector: config.listContainerSelector,
    })
    metadata.webListIssues = issues
    if (skipped.length) {
      metadata.skipped = skipped
    }
    return {
      applied: false,
      items: [],
      metadata,
    }
  }

  const nodes = container.find(config.itemSelector).toArray() as Element[]
  metadata.candidateCount = nodes.length

  if (!nodes.length) {
    issues.push({
      reason: 'list_items_not_found',
      selector: config.itemSelector,
    })
    metadata.webListIssues = issues
    if (skipped.length) {
      metadata.skipped = skipped
    }
    return {
      applied: false,
      items: [],
      metadata,
    }
  }

  const limitedNodes = nodes.slice(0, MAX_LIST_ITEMS)
  if (nodes.length > MAX_LIST_ITEMS) {
    skipped.push({
      reason: 'max_items_exceeded',
      limit: MAX_LIST_ITEMS,
      skipped: nodes.length - MAX_LIST_ITEMS,
    })
  }

  const nowIso = now.toISOString()
  const seenUrls = new Set<string>()
  const items: NormalizedDiscoveryItemEnvelope[] = []
  const transformStats: ValueTransformStats = { applied: 0, misses: 0 }

  for (const [localIndex, element] of limitedNodes.entries()) {
    const result = buildListItem({
      $,
      element,
      index: localIndex,
      config,
      baseUrl,
      nowIso,
      transformStats,
    })

    if (!result.ok) {
      skipped.push({
        reason: result.reason,
        index: localIndex,
        details: result.details,
      })
      continue
    }

    const urlKey = result.urlKey
    if (urlKey && seenUrls.has(urlKey)) {
      skipped.push({
        reason: 'duplicate_url',
        index: localIndex,
        details: { url: urlKey },
      })
      continue
    }

    if (urlKey) {
      seenUrls.add(urlKey)
    }

    items.push(result.item)
  }

  metadata.valueTransformApplied = transformStats.applied
  metadata.valueTransformMisses = transformStats.misses
  metadata.webListApplied = items.length > 0
  metadata.listItemCount = items.length
  metadata.paginationDepth = 1
  metadata.processedCount = items.length
  metadata.uniqueUrlCount = seenUrls.size

  if (skipped.length) {
    metadata.skipped = skipped
  }

  if (!metadata.webListApplied) {
    issues.push({
      reason: 'no_items_extracted',
      selector: config.itemSelector,
    })
  }

  if (issues.length) {
    metadata.webListIssues = issues
  }

  return {
    applied: Boolean(metadata.webListApplied),
    items,
    metadata,
  }
}

function buildListItem(context: BuildListItemContext): BuildListItemResult {
  const { $, element, config, baseUrl, index, nowIso, transformStats } = context
  const itemNode = $(element)
  const itemHtml = $.html(element) ?? ''

  const {
    values: configuredFields,
    transformStates,
  } = extractConfiguredFields(itemNode, config, transformStats)
  const anchor = itemNode.find('a').first()
  const anchorHref = anchor.attr('href')?.trim() ?? null

  const resolvedUrl = resolveAbsoluteUrl(configuredFields.url ?? anchorHref, baseUrl)
  if (!resolvedUrl) {
    return {
      ok: false,
      reason: 'missing_url',
      details: {
        anchorHref,
        configuredUrl: configuredFields.url ?? null,
      },
    }
  }

  const rawTitle = configuredFields.title
    ?? anchor.text().trim()
    ?? itemNode.find('h1, h2, h3').first().text().trim()
    ?? itemNode.text().trim()
    ?? resolvedUrl
  const normalizedTitle = normalizeTitle(rawTitle) ?? resolvedUrl

  let extractedBody = sanitizeHtmlContent(itemHtml).trim()
  if (!extractedBody) {
    const fallbackBody = itemNode.text().trim() || normalizedTitle
    extractedBody = sanitizeHtmlContent(fallbackBody, 2_000).trim() || normalizedTitle
  }

  if (!extractedBody) {
    return {
      ok: false,
      reason: 'empty_body',
      details: {
        title: normalizedTitle,
      },
    }
  }

  const excerptSource = configuredFields.excerpt ?? extractedBody
  const excerptSanitized = sanitizeHtmlContent(excerptSource, 1_000)
  const excerpt = excerptSanitized ? createExcerpt(excerptSanitized) : null

  const timestampCandidate =
    configuredFields.timestamp
    ?? anchor.attr('data-published')?.trim()
    ?? itemNode.find('time[datetime]').first().attr('datetime')?.trim()
    ?? itemNode.find('time').first().text().trim()
    ?? null

  const published = resolvePublishedAt(timestampCandidate, nowIso)

  const candidate = {
    externalId: resolvedUrl,
    title: normalizedTitle,
    url: resolvedUrl,
    contentType: 'article' as const,
    publishedAt: published.publishedAt,
    publishedAtSource: published.source,
    fetchedAt: nowIso,
    extractedBody,
    excerpt,
  }

  const parsed = normalizedDiscoveryAdapterItemSchema.safeParse(candidate)
  if (!parsed.success) {
    return {
      ok: false,
      reason: 'validation_failed',
      details: {
        issues: parsed.error.issues.map((issue) => issue.message),
      },
    }
  }

  const sourceMetadata: ArticleSourceMetadata = {
    contentType: 'article',
    canonicalUrl: resolvedUrl,
  }

  const rawPayload: Record<string, unknown> = {
    index,
    html: itemHtml,
    resolvedUrl,
    fields: configuredFields,
  }
  if (Object.keys(transformStates).length > 0) {
    rawPayload.valueTransformStates = transformStates
  }
  if (timestampCandidate) {
    rawPayload.timestampCandidate = timestampCandidate
  }
  if (published.invalid) {
    rawPayload.invalidTimestamp = published.invalid
  }

  return {
    ok: true,
    item: {
      rawPayload,
      normalized: parsed.data,
      sourceMetadata,
    },
    urlKey: resolvedUrl,
  }
}

function extractConfiguredFields(
  node: Cheerio<Element>,
  config: DiscoverySourceWebListConfig,
  stats: ValueTransformStats,
): { values: ConfiguredFieldMap; transformStates: FieldTransformTelemetry } {
  const values: ConfiguredFieldMap = {}
  const transformStates: FieldTransformTelemetry = {}
  const fields = config.fields ?? {}
  for (const [field, descriptor] of Object.entries(fields)) {
    if (!KNOWN_WEB_LIST_FIELDS.has(field)) continue
    if (!descriptor) continue
    const typedDescriptor = descriptor as DiscoverySourceWebListSelector
    const result = extractSelectorValue(node, typedDescriptor)
    if (result.transformState === 'applied') {
      stats.applied += 1
    }
    if (result.transformState === 'missed') {
      stats.misses += 1
    }
    if (result.transformState !== 'none') {
      transformStates[field as keyof FieldTransformTelemetry] = result.transformState
    }
    if (result.value) {
      values[field as keyof ConfiguredFieldMap] = result.value
    }
  }
  return { values, transformStates }
}

function extractSelectorValue(
  root: Cheerio<Element>,
  descriptor: DiscoverySourceWebListSelector,
): { value: string | null; transformState: FieldTransformState } {
  const target = descriptor.selector ? root.find(descriptor.selector).first() : root
  if (!target.length) {
    return { value: null, transformState: 'none' }
  }
  const rawValue = descriptor.attribute ? target.attr(descriptor.attribute) ?? null : target.text()
  if (!rawValue) {
    return { value: null, transformState: 'none' }
  }
  const trimmed = rawValue.trim()
  if (!trimmed) {
    return { value: null, transformState: 'none' }
  }
  const transformed = applyValueTransform(descriptor.valueTransform, trimmed)
  const finalValue = transformed.value.trim()
  return {
    value: finalValue || null,
    transformState: transformed.state,
  }
}

function applyValueTransform(
  transform: DiscoverySourceWebListSelector['valueTransform'],
  value: string,
): { value: string; state: FieldTransformState } {
  if (!transform) {
    return { value, state: 'none' }
  }
  try {
    const flags = transform.flags
    const matcher = new RegExp(transform.pattern, flags)
    if (!matcher.test(value)) {
      return { value, state: 'missed' }
    }
    const replacement = transform.replacement ?? '$1'
    const replaced = value.replace(new RegExp(transform.pattern, flags), replacement)
    return {
      value: replaced,
      state: 'applied',
    }
  } catch {
    return { value, state: 'missed' }
  }
}

function resolveAbsoluteUrl(value: string | null | undefined, baseUrl: string): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const resolved = new URL(trimmed, baseUrl)
    if (!SUPPORTED_URL_PROTOCOLS.has(resolved.protocol)) {
      return null
    }
    return resolved.toString()
  } catch {
    return null
  }
}

function resolvePublishedAt(raw: string | null, nowIso: string): PublishedAtResolution {
  if (!raw) {
    return { publishedAt: nowIso, source: 'fallback' }
  }
  const trimmed = raw.trim()
  if (!trimmed) {
    return { publishedAt: nowIso, source: 'fallback', invalid: raw }
  }

  let date: Date | null = null
  if (/^\d{10}$/.test(trimmed)) {
    const unixSeconds = Number.parseInt(trimmed, 10)
    if (Number.isFinite(unixSeconds)) {
      date = new Date(unixSeconds * 1_000)
    }
  } else if (/^\d{13}$/.test(trimmed)) {
    const unixMillis = Number.parseInt(trimmed, 10)
    if (Number.isFinite(unixMillis)) {
      date = new Date(unixMillis)
    }
  } else {
    const parsed = new Date(trimmed)
    if (!Number.isNaN(parsed.getTime())) {
      date = parsed
    }
  }

  if (!date || Number.isNaN(date.getTime())) {
    return { publishedAt: nowIso, source: 'fallback', invalid: trimmed }
  }

  return {
    publishedAt: date.toISOString(),
    source: 'original',
  }
}

function createMetadata(
  status: number,
  bodyLength: number,
  itemCount: number,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    adapter: 'http',
    status,
    contentLength: bodyLength,
    itemCount,
    skippedCount: 0,
    ...(extras ?? {}),
  }

  const skipped = (metadata as { skipped?: unknown[] }).skipped
  if (Array.isArray(skipped)) {
    metadata.skippedCount = skipped.length
  }

  const hasWebListContext = Boolean((metadata as { webListConfigured?: boolean }).webListConfigured)
  if (hasWebListContext && typeof metadata.listItemCount !== 'number') {
    const applied = Boolean((metadata as { webListApplied?: boolean }).webListApplied)
    metadata.listItemCount = applied ? itemCount : 0
  } else if (!hasWebListContext) {
    delete metadata.listItemCount
    delete metadata.webListApplied
    delete metadata.webListAttempted
    delete metadata.webListIssues
  }

  return metadata
}

export const fetchHttpSource: DiscoveryIngestionAdapter = async (input, context): Promise<DiscoveryAdapterResult> => {
  const fetcher: typeof globalThis.fetch | undefined = context?.fetch ?? globalThis.fetch
  if (!fetcher) {
    return {
      ok: false,
      failureReason: 'unknown_error',
      error: new Error('No fetch implementation available for HTTP adapter'),
    }
  }

  try {
    const response = await fetcher(input.url, { signal: context?.signal })

    const status = response.status
    const headers = Object.fromEntries(response.headers.entries())
    const body = await response.text()

    if (!response.ok) {
      const failureReason = resolveFailureReason(status)
      return {
        ok: false,
        failureReason,
        raw: {
          status,
          statusText: response.statusText,
          headers,
          body,
        },
        retryInMinutes: failureReason === 'http_5xx' ? 5 : null,
        metadata: {
          adapter: 'http',
          status,
        },
      }
    }

    const now = context?.now?.() ?? new Date()
    const finalUrl = response.url || input.canonicalUrl || input.url
    const webListConfig = input.config?.webList ?? null
    const webListOutcome = webListConfig
      ? extractListItems(body, webListConfig, finalUrl, now)
      : null

    if (webListOutcome && webListOutcome.applied && webListOutcome.items.length > 0) {
      const metadata = createMetadata(status, body.length, webListOutcome.items.length, {
        ...webListOutcome.metadata,
      })
      return {
        ok: true,
        items: webListOutcome.items,
        raw: {
          status,
          headers,
        },
        metadata,
      }
    }

    const sanitizedBody = sanitizeHtmlContent(body)

    if (!sanitizedBody) {
      const metadata = createMetadata(status, body.length, 0, {
        ...(webListOutcome?.metadata ?? {}),
      })
      return {
        ok: false,
        failureReason: 'parser_error',
        raw: {
          status,
          headers,
          body,
        },
        metadata: {
          ...metadata,
          message: 'Empty body after sanitization',
        },
      }
    }

    const nowIso = now.toISOString()
    const fallbackUrl = finalUrl
    const metaTitle = extractMetaContent(body, ['og:title', 'twitter:title'])
    const titleFromTag = (() => {
      const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)
      return match ? match[1] : null
    })()
    const normalizedTitle = normalizeTitle(metaTitle ?? titleFromTag) ?? normalizeTitle(fallbackUrl) ?? 'Untitled Article'

    const metaPublished = extractMetaContent(body, [
      'article:published_time',
      'og:published_time',
      'pubdate',
      'date',
      'dc.date',
      'dc.date.issued',
    ])
    const timeTagMatch = /<time[^>]*datetime="([^"]+)"[^>]*>/i.exec(body) ?? /<time[^>]*datetime='([^']+)'[^>]*>/i.exec(body)
    const published = derivePublishedAt([metaPublished, timeTagMatch?.[1] ?? null], now)

    const htmlLangMatch = /<html[^>]*lang="([^"]+)"[^>]*>/i.exec(body) ?? /<html[^>]*lang='([^']+)'[^>]*>/i.exec(body)
    const contentLanguage = extractMetaContent(body, ['og:locale', 'language', 'content-language']) ?? htmlLangMatch?.[1] ?? null

    const candidate = {
      externalId: fallbackUrl,
      title: normalizedTitle,
      url: fallbackUrl,
      contentType: 'article' as const,
      publishedAt: published.publishedAt,
      publishedAtSource: published.source,
      fetchedAt: nowIso,
      extractedBody: sanitizedBody,
      excerpt: createExcerpt(sanitizedBody),
    }

    const parsed = normalizedDiscoveryAdapterItemSchema.safeParse(candidate)
    if (!parsed.success) {
      const metadata = createMetadata(status, body.length, 0, {
        ...(webListOutcome?.metadata ?? {}),
      })
      return {
        ok: false,
        failureReason: 'parser_error',
        raw: {
          status,
          headers,
          body,
        },
        metadata: {
          ...metadata,
          validationIssues: parsed.error.issues.map((issue) => issue.message),
        },
      }
    }

    const sourceMetadata: ArticleSourceMetadata = {
      contentType: 'article',
      canonicalUrl: fallbackUrl,
      language: contentLanguage?.toLowerCase() ?? null,
    }

    const metadata = createMetadata(status, body.length, 1, {
      ...(webListOutcome?.metadata ?? {}),
    })

    return {
      ok: true,
      items: [
        {
          rawPayload: {
            status,
            headers,
            body,
            url: fallbackUrl,
          },
          normalized: parsed.data,
          sourceMetadata,
        },
      ],
      raw: {
        status,
        headers,
      },
      metadata,
    }
  } catch (error) {
    const err = error as Error & { name?: string }
    const failureReason: DiscoveryIngestionFailureReason = err.name === 'AbortError' ? 'timeout' : 'network_error'
    return {
      ok: false,
      failureReason,
      error: err,
      retryInMinutes: failureReason === 'network_error' ? 5 : null,
      metadata: {
        adapter: 'http',
        message: err.message,
      },
    }
  }
}

export default fetchHttpSource
