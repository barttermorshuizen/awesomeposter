import { z } from 'zod'
import { discoveryBriefReferenceSchema } from './item.js'

const ALLOWED_PAGE_SIZES = [25, 50, 100] as const

export const discoverySearchStatusSchema = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.toLowerCase())
  .pipe(z.enum(['spotted', 'approved', 'suppressed', 'archived', 'pending', 'promoted']))

export type DiscoverySearchStatus = z.infer<typeof discoverySearchStatusSchema>

export const discoverySearchFiltersSchema = z.object({
  clientId: z.string().uuid(),
  statuses: z.array(discoverySearchStatusSchema).default(['spotted']),
  sourceIds: z.array(z.string().uuid()).default([]),
  topics: z.array(z.string().trim().min(1)).default([]),
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().refine((value) => ALLOWED_PAGE_SIZES.includes(value as (typeof ALLOWED_PAGE_SIZES)[number]), {
    message: `pageSize must be one of ${ALLOWED_PAGE_SIZES.join(', ')}`,
  }).default(25),
  searchTerm: z.string().trim().min(2).max(160).optional(),
})

export type DiscoverySearchFilters = z.infer<typeof discoverySearchFiltersSchema>

type RawQueryValue = string | string[] | undefined | null

function toArray(value: RawQueryValue): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => (typeof entry === 'string' ? entry.split(',') : []))
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
  }
  return []
}

function firstString(value: RawQueryValue): string | undefined {
  if (Array.isArray(value)) {
    const match = value.find((entry) => typeof entry === 'string' && entry.length > 0)
    return match?.trim() || undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }
  return undefined
}

export function parseDiscoverySearchFilters(query: Record<string, RawQueryValue>): DiscoverySearchFilters {
  const parsed = discoverySearchFiltersSchema.parse({
    clientId: firstString(query.clientId),
    statuses: toArray(query.status ?? query.statuses),
    sourceIds: toArray(query.sourceId ?? query.sourceIds ?? query.sources),
    topics: toArray(query.topic ?? query.topics),
    dateFrom: firstString(query.dateFrom),
    dateTo: firstString(query.dateTo),
    page: firstString(query.page),
    pageSize: firstString(query.pageSize),
    searchTerm: firstString(query.searchTerm ?? query.search),
  })

  if (parsed.statuses.length === 0) {
    parsed.statuses = ['spotted']
  }

  return parsed
}

export const discoverySearchHighlightSchema = z.object({
  field: z.enum(['title', 'excerpt', 'body']),
  snippets: z.array(z.string().min(1)).max(5),
})

export type DiscoverySearchHighlight = z.infer<typeof discoverySearchHighlightSchema>

export const discoverySearchItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  url: z.string().url(),
  status: discoverySearchStatusSchema,
  briefRef: discoveryBriefReferenceSchema.nullable().optional(),
  score: z.number().min(0).max(1).nullable(),
  sourceId: z.string().uuid(),
  fetchedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  ingestedAt: z.string().datetime(),
  summary: z.string().nullable(),
  topics: z.array(z.string()),
  highlights: z.array(discoverySearchHighlightSchema),
})

export type DiscoverySearchItem = z.infer<typeof discoverySearchItemSchema>

export const discoverySearchResponseSchema = z.object({
  items: z.array(discoverySearchItemSchema),
  total: z.number().int().min(0),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1),
  latencyMs: z.number().min(0),
})

export type DiscoverySearchResponse = z.infer<typeof discoverySearchResponseSchema>

export const DISCOVERY_SEARCH_PAGE_SIZES = ALLOWED_PAGE_SIZES
