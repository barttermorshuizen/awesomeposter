import { z } from 'zod'
import { discoverySearchStatusSchema } from './search.js'

export const DISCOVERY_BULK_SELECTION_LIMIT = 100 as const

export const discoveryBulkFiltersSnapshotSchema = z.object({
  status: z.array(discoverySearchStatusSchema).min(1).max(10),
  sourceIds: z.array(z.string().uuid()),
  topicIds: z.array(z.string()),
  search: z.string(),
  dateFrom: z.string().datetime().nullable(),
  dateTo: z.string().datetime().nullable(),
  pageSize: z.number().int().min(1),
})

export type DiscoveryBulkFiltersSnapshot = z.infer<typeof discoveryBulkFiltersSnapshotSchema>

export const discoveryBulkActionRequestSchema = z.object({
  actionId: z.string().uuid(),
  clientId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1).max(DISCOVERY_BULK_SELECTION_LIMIT),
  note: z
    .string()
    .min(5, 'Bulk action note must be at least 5 characters long.')
    .max(2000, 'Bulk action note must be fewer than 2000 characters.')
    .refine((value) => /^[\x20-\x7E\r\n\t]*$/.test(value), {
      message: 'Bulk action note must contain ASCII characters only.',
    })
    .transform((value) => value.trim()),
  actorId: z.string().uuid(),
  filtersSnapshot: discoveryBulkFiltersSnapshotSchema,
})

export type DiscoveryBulkActionRequest = z.infer<typeof discoveryBulkActionRequestSchema>

export const discoveryBulkActionItemResultSchema = z.object({
  itemId: z.string().uuid(),
  status: z.enum(['success', 'conflict', 'failed']),
  message: z.string().optional().nullable(),
  briefId: z.string().uuid().optional().nullable(),
})

export type DiscoveryBulkActionItemResult = z.infer<typeof discoveryBulkActionItemResultSchema>

export const discoveryBulkActionResponseSchema = z.object({
  actionId: z.string().uuid(),
  summary: z.object({
    success: z.number().int().min(0),
    conflict: z.number().int().min(0),
    failed: z.number().int().min(0),
    durationMs: z.number().int().min(0),
  }),
  results: z.array(discoveryBulkActionItemResultSchema),
})

export type DiscoveryBulkActionResponse = z.infer<typeof discoveryBulkActionResponseSchema>
