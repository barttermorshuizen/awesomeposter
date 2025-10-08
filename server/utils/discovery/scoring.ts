import {
  normalizedDiscoveryAdapterItemSchema,
  discoveryContentTypeSchema,
  type NormalizedDiscoveryAdapterItem,
  type DiscoveryContentType,
} from '@awesomeposter/shared'
import { z } from 'zod'
import { getKeywordThemesForClient } from '../discovery-keyword-cache'
import { isFeatureEnabled, FEATURE_DISCOVERY_AGENT } from '../client-config/feature-flags'
import {
  fetchDiscoveryItemsForScoring,
  type DiscoveryItemForScoring,
} from '../discovery-repository'

const SCORE_FEATURE_FLAG = FEATURE_DISCOVERY_AGENT

const DEFAULT_SOURCE_MULTIPLIERS: Record<DiscoveryContentType, number> = {
  article: 1,
  rss: 0.85,
  youtube: 0.75,
}

const DEFAULT_COMPONENT_WEIGHTS = {
  keyword: 0.5,
  recency: 0.3,
  source: 0.2,
} satisfies ComponentWeights

const DEFAULT_THRESHOLD = 0.6
const DEFAULT_RECENCY_HALF_LIFE_HOURS = 48
const DEFAULT_WEIGHTS_VERSION = 1

const SOURCE_METADATA_CONTENT_TYPE = z.object({
  contentType: discoveryContentTypeSchema.optional(),
})

type ComponentWeights = {
  keyword: number
  recency: number
  source: number
}

type SourceMultipliers = Record<DiscoveryContentType, number>

type ScoringConfig = {
  weights: ComponentWeights
  threshold: number
  recencyHalfLifeHours: number
  sourceMultipliers: SourceMultipliers
  weightsVersion: number
}

export type DiscoveryScoreComponents = {
  keyword: number
  recency: number
  source: number
}

export type DiscoveryScoreResult = {
  itemId: string
  clientId: string
  sourceId: string
  score: number
  components: DiscoveryScoreComponents
  appliedThreshold: number
  status: 'scored' | 'suppressed'
  weightsVersion: number
  matchedKeywords: string[]
}

export type DiscoveryScoreConfigSnapshot = {
  weights: ComponentWeights
  threshold: number
  recencyHalfLifeHours: number
  weightsVersion: number
}

export type ScoreDiscoverySuccess = {
  ok: true
  result: DiscoveryScoreResult
  config: DiscoveryScoreConfigSnapshot
}

export type ScoreDiscoveryItemsSuccess = {
  ok: true
  results: DiscoveryScoreResult[]
  config: DiscoveryScoreConfigSnapshot
}

export type ScoreDiscoveryError = {
  ok: false
  error: {
    code: string
    message: string
    details?: Record<string, unknown>
  }
}

type ScoreDiscoveryOptions = {
  now?: () => Date
}

let cachedConfig: ScoringConfig | null = null

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0
  if (value <= 0) return 0
  if (value >= 1) return 1
  return value
}

function roundTo(value: number, precision = 4) {
  const factor = 10 ** precision
  return Math.round(value * factor) / factor
}

function parseNumberEnv(key: string, fallback: number, { min, max }: { min?: number; max?: number } = {}) {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const parsed = Number.parseFloat(raw)
  if (!Number.isFinite(parsed)) return fallback
  if (min !== undefined && parsed < min) return fallback
  if (max !== undefined && parsed > max) return fallback
  return parsed
}

function normalizeWeights(weights: ComponentWeights): ComponentWeights {
  const { keyword, recency, source } = weights
  const sum = keyword + recency + source
  if (!Number.isFinite(sum) || sum <= 0) {
    return { ...DEFAULT_COMPONENT_WEIGHTS }
  }
  return {
    keyword: keyword / sum,
    recency: recency / sum,
    source: source / sum,
  }
}

function resolveScoringConfig(): ScoringConfig {
  if (cachedConfig) {
    return cachedConfig
  }

  const weightsRaw: ComponentWeights = {
    keyword: parseNumberEnv('DISCOVERY_SCORING_KEYWORD_WEIGHT', DEFAULT_COMPONENT_WEIGHTS.keyword, { min: 0 }),
    recency: parseNumberEnv('DISCOVERY_SCORING_RECENCY_WEIGHT', DEFAULT_COMPONENT_WEIGHTS.recency, { min: 0 }),
    source: parseNumberEnv('DISCOVERY_SCORING_SOURCE_WEIGHT', DEFAULT_COMPONENT_WEIGHTS.source, { min: 0 }),
  }

  const normalizedWeights = normalizeWeights(weightsRaw)

  const sourceMultipliers: SourceMultipliers = {
    article: clamp01(parseNumberEnv('DISCOVERY_SCORING_SOURCE_WEIGHT_ARTICLE', DEFAULT_SOURCE_MULTIPLIERS.article, { min: 0 })),
    rss: clamp01(parseNumberEnv('DISCOVERY_SCORING_SOURCE_WEIGHT_RSS', DEFAULT_SOURCE_MULTIPLIERS.rss, { min: 0 })),
    youtube: clamp01(parseNumberEnv('DISCOVERY_SCORING_SOURCE_WEIGHT_YOUTUBE', DEFAULT_SOURCE_MULTIPLIERS.youtube, { min: 0 })),
  }

  const threshold = clamp01(parseNumberEnv('DISCOVERY_SCORING_THRESHOLD', DEFAULT_THRESHOLD, { min: 0, max: 1 }))
  const recencyHalfLifeHours = Math.max(1, parseNumberEnv('DISCOVERY_SCORING_RECENCY_HALF_LIFE_HOURS', DEFAULT_RECENCY_HALF_LIFE_HOURS, { min: 1 }))
  const weightsVersion = Math.trunc(parseNumberEnv('DISCOVERY_SCORING_WEIGHTS_VERSION', DEFAULT_WEIGHTS_VERSION, { min: 1 })) || DEFAULT_WEIGHTS_VERSION

  cachedConfig = {
    weights: normalizedWeights,
    threshold,
    recencyHalfLifeHours,
    sourceMultipliers,
    weightsVersion,
  }

  return cachedConfig
}

function buildConfigSnapshot(config: ScoringConfig): DiscoveryScoreConfigSnapshot {
  return {
    weights: config.weights,
    threshold: config.threshold,
    recencyHalfLifeHours: config.recencyHalfLifeHours,
    weightsVersion: config.weightsVersion,
  }
}

const KEYWORD_MATCH_DAMPING = 2

function computeKeywordScore(
  normalized: NormalizedDiscoveryAdapterItem,
  keywords: string[],
): { score: number; matchedKeywords: string[] } {
  if (!keywords.length) return { score: 0, matchedKeywords: [] }
  const text = `${normalized.title} ${normalized.extractedBody}`.toLowerCase()
  if (!text) return { score: 0, matchedKeywords: [] }

  let matches = 0
  const seen = new Set<string>()
  const matchedKeywords: string[] = []
  for (const keyword of keywords) {
    const original = keyword.trim()
    if (!original) {
      continue
    }
    const normalizedKeyword = original.toLowerCase()
    if (seen.has(normalizedKeyword)) {
      continue
    }
    seen.add(normalizedKeyword)
    if (text.includes(normalizedKeyword)) {
      matches += 1
      matchedKeywords.push(original)
    }
  }
  if (!seen.size) {
    return { score: 0, matchedKeywords: [] }
  }
  if (matches === 0) {
    return { score: 0, matchedKeywords: [] }
  }

  const coverage = matches / seen.size
  const matchInfluence = matches / (matches + KEYWORD_MATCH_DAMPING)
  const boosted = coverage + (1 - coverage) * matchInfluence
  return { score: clamp01(boosted), matchedKeywords }
}

function computeRecencyScore(item: DiscoveryItemForScoring, normalized: NormalizedDiscoveryAdapterItem, halfLifeHours: number, now: Date): number {
  const referenceDate = normalized.publishedAt ? new Date(normalized.publishedAt) : item.fetchedAt
  if (!(referenceDate instanceof Date) || Number.isNaN(referenceDate.getTime())) {
    return 0
  }
  const ageMs = now.getTime() - referenceDate.getTime()
  if (ageMs <= 0) {
    return 1
  }
  const ageHours = ageMs / (1000 * 60 * 60)
  const decay = Math.pow(0.5, ageHours / halfLifeHours)
  return clamp01(decay)
}

function computeSourceScore(normalized: NormalizedDiscoveryAdapterItem, sourceMetadata: Record<string, unknown>, multipliers: SourceMultipliers): number {
  let contentType = normalized.contentType
  if (!contentType) {
    const parsed = SOURCE_METADATA_CONTENT_TYPE.safeParse(sourceMetadata)
    if (parsed.success && parsed.data.contentType) {
      contentType = parsed.data.contentType
    }
  }
  const multiplier = multipliers[contentType] ?? multipliers.article
  return clamp01(multiplier)
}

function toScoreResult(
  item: DiscoveryItemForScoring,
  normalized: NormalizedDiscoveryAdapterItem,
  keywords: string[],
  config: ScoringConfig,
  now: Date,
): DiscoveryScoreResult {
  const keywordScore = computeKeywordScore(normalized, keywords)
  const keywordComponent = keywordScore.score
  const recencyComponent = computeRecencyScore(item, normalized, config.recencyHalfLifeHours, now)
  const sourceComponent = computeSourceScore(normalized, item.sourceMetadata ?? {}, config.sourceMultipliers)

  const score = clamp01(
    keywordComponent * config.weights.keyword +
      recencyComponent * config.weights.recency +
      sourceComponent * config.weights.source,
  )

  const status = score >= config.threshold ? 'scored' : 'suppressed'

  return {
    itemId: item.id,
    clientId: item.clientId,
    sourceId: item.sourceId,
    score: roundTo(score),
    components: {
      keyword: roundTo(keywordComponent),
      recency: roundTo(recencyComponent),
      source: roundTo(sourceComponent),
    },
    appliedThreshold: config.threshold,
    status,
    weightsVersion: config.weightsVersion,
    matchedKeywords: keywordScore.matchedKeywords,
  }
}

function buildMissingItemsError(itemIds: string[]): ScoreDiscoveryError {
  return {
    ok: false,
    error: {
      code: 'DISCOVERY_SCORING_NOT_FOUND',
      message: 'One or more discovery items could not be found.',
      details: { itemIds },
    },
  }
}

function buildDisabledError(clientId: string, itemIds: string[]): ScoreDiscoveryError {
  return {
    ok: false,
    error: {
      code: 'DISCOVERY_SCORING_DISABLED',
      message: 'Discovery scoring is not enabled for this client.',
      details: { clientId, itemIds },
    },
  }
}

function buildInvalidItemsError(invalidItems: Array<{ itemId: string; reason: string }>): ScoreDiscoveryError {
  return {
    ok: false,
    error: {
      code: 'DISCOVERY_SCORING_INVALID_ITEM',
      message: 'One or more discovery items are missing required data for scoring.',
      details: { invalidItems },
    },
  }
}

function sanitizeIds(itemIds: string[]): string[] {
  return itemIds
    .map((id) => id?.trim())
    .filter((id): id is string => Boolean(id))
}

/**
 * Compute the relevance score for a single discovery item. Returns a structured
 * response including component breakdown and the scoring configuration snapshot.
 *
 * @example
 * const response = await scoreDiscoveryItem('item-123');
 * if (response.ok) {
 *   console.log(response.result.score, response.result.components.keyword);
 * }
 */
export async function scoreDiscoveryItem(itemId: string, options?: ScoreDiscoveryOptions): Promise<ScoreDiscoverySuccess | ScoreDiscoveryError> {
  const result = await scoreDiscoveryItems([itemId], options)
  if (!result.ok) {
    return result
  }
  return {
    ok: true,
    result: result.results[0]!,
    config: result.config,
  }
}

/**
 * Batch scoring helper that enforces feature-flag gating, validates inputs, and
 * short-circuits on the first invalid item. Consumers should inspect the
 * returned `ok` flag before relying on `results`.
 */
export async function scoreDiscoveryItems(
  itemIds: string[],
  options?: ScoreDiscoveryOptions,
): Promise<ScoreDiscoveryItemsSuccess | ScoreDiscoveryError> {
  const sanitizedIds = sanitizeIds(itemIds)
  if (!sanitizedIds.length) {
    const config = resolveScoringConfig()
    return {
      ok: true,
      results: [],
      config: buildConfigSnapshot(config),
    }
  }

  const uniqueIds = Array.from(new Set(sanitizedIds))
  const items = await fetchDiscoveryItemsForScoring(uniqueIds)
  if (items.length !== uniqueIds.length) {
    const foundIds = new Set(items.map((item) => item.id))
    const missing = uniqueIds.filter((id) => !foundIds.has(id))
    return buildMissingItemsError(missing)
  }

  const itemsById = new Map(items.map((item) => [item.id, item]))

  const config = resolveScoringConfig()
  const now = options?.now?.() ?? new Date()

  const itemOrder = sanitizedIds.map((id) => itemsById.get(id)!)

  const itemsByClient = new Map<string, DiscoveryItemForScoring[]>()
  for (const item of itemOrder) {
    const bucket = itemsByClient.get(item.clientId)
    if (bucket) {
      bucket.push(item)
    } else {
      itemsByClient.set(item.clientId, [item])
    }
  }

  for (const [clientId, clientItems] of itemsByClient.entries()) {
    const enabled = await isFeatureEnabled(clientId, SCORE_FEATURE_FLAG)
    if (!enabled) {
      return buildDisabledError(clientId, clientItems.map((item) => item.id))
    }
  }

  const keywordsByClient = new Map<string, string[]>()
  for (const clientId of itemsByClient.keys()) {
    const keywords = await getKeywordThemesForClient(clientId)
    keywordsByClient.set(clientId, keywords)
  }

  const invalidItems: Array<{ itemId: string; reason: string }> = []
  const resultsById = new Map<string, DiscoveryScoreResult>()

  for (const item of items) {
    const normalizedParse = normalizedDiscoveryAdapterItemSchema.safeParse(item.normalized)
    if (!normalizedParse.success) {
      invalidItems.push({ itemId: item.id, reason: 'normalized_payload_invalid' })
      continue
    }
    const normalized = normalizedParse.data
    if (!normalized.extractedBody || normalized.extractedBody.trim().length === 0) {
      invalidItems.push({ itemId: item.id, reason: 'extracted_body_missing' })
      continue
    }
    const keywords = keywordsByClient.get(item.clientId) ?? []
    const scoreResult = toScoreResult(item, normalized, keywords, config, now)
    resultsById.set(item.id, scoreResult)
  }

  if (invalidItems.length) {
    return buildInvalidItemsError(invalidItems)
  }

  const orderedResults = sanitizedIds.map((id) => resultsById.get(id)!)

  return {
    ok: true,
    results: orderedResults,
    config: buildConfigSnapshot(config),
  }
}

export function __resetDiscoveryScoringCacheForTests() {
  cachedConfig = null
}
