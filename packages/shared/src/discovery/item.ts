import { z } from 'zod'
import { discoverySourceTypeSchema } from '../discovery.js'

export const discoveryItemStatusSchema = z.enum([
  'pending_scoring',
  'scored',
  'suppressed',
  'promoted',
  'archived',
])

export type DiscoveryItemStatus = z.infer<typeof discoveryItemStatusSchema>

export const discoveryBriefReferenceSchema = z.object({
  briefId: z.string().uuid(),
  editUrl: z
    .string()
    .trim()
    .refine((value) => {
      if (!value) return false
      if (/^https?:\/\//i.test(value)) {
        try {
          new URL(value)
          return true
        } catch {
          return false
        }
      }
      return value.startsWith('/')
    }, { message: 'Invalid url' }),
})

export type DiscoveryBriefReference = z.infer<typeof discoveryBriefReferenceSchema>

export const discoveryItemHistoryEntrySchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
  previousStatus: discoveryItemStatusSchema.nullable(),
  nextStatus: discoveryItemStatusSchema,
  note: z.string(),
  actorId: z.string().uuid(),
  actorName: z.string(),
  occurredAt: z.string().datetime(),
})

export type DiscoveryItemHistoryEntry = z.infer<typeof discoveryItemHistoryEntrySchema>

export const discoveryItemScoreDetailsSchema = z.object({
  total: z.number().nullable(),
  keyword: z.number().nullable(),
  recency: z.number().nullable(),
  source: z.number().nullable(),
  appliedThreshold: z.number().nullable(),
})

export type DiscoveryItemScoreDetails = z.infer<typeof discoveryItemScoreDetailsSchema>

export const discoveryItemDuplicateRefSchema = z.object({
  itemId: z.string().uuid(),
  title: z.string().nullable(),
  url: z.string().url().nullable(),
  status: discoveryItemStatusSchema,
})

export type DiscoveryItemDuplicateRef = z.infer<typeof discoveryItemDuplicateRefSchema>

export const discoveryItemDetailSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  title: z.string(),
  url: z.string().url(),
  status: discoveryItemStatusSchema,
  fetchedAt: z.string().datetime(),
  publishedAt: z.string().datetime().nullable(),
  ingestedAt: z.string().datetime(),
  source: z.object({
    id: z.string().uuid(),
    name: z.string().nullable(),
    type: discoverySourceTypeSchema,
    url: z.string().url().nullable(),
  }),
  summary: z.string().nullable(),
  body: z.string().nullable(),
  topics: z.array(z.string()),
  score: discoveryItemScoreDetailsSchema,
  statusHistory: z.array(discoveryItemHistoryEntrySchema),
  duplicateRefs: z.array(discoveryItemDuplicateRefSchema).default([]),
  briefRef: discoveryBriefReferenceSchema.nullable().optional(),
})

export type DiscoveryItemDetail = z.infer<typeof discoveryItemDetailSchema>

export const discoveryPromoteItemInputSchema = z.object({
  note: z
    .string()
    .min(5, 'Promotion note must be at least 5 characters long.')
    .max(2000, 'Promotion note must be fewer than 2000 characters.')
    .refine((value) => /^[\x20-\x7E\r\n\t]*$/.test(value), {
      message: 'Promotion note must contain ASCII characters only.',
    })
    .transform((value) => value.trim()),
})

export type DiscoveryPromoteItemInput = z.infer<typeof discoveryPromoteItemInputSchema>
