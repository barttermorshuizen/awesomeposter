import { z } from 'zod'
import { discoverySourceTypeSchema } from './discovery.js'

export const discoverySourceSchema = z.object({
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  url: z.string().url(),
  canonicalUrl: z.string().url(),
  sourceType: discoverySourceTypeSchema,
  identifier: z.string(),
  notes: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export type DiscoverySource = z.infer<typeof discoverySourceSchema>

export const discoverySourceCreatedEventSchema = z.object({
  type: z.literal('source-created'),
  version: z.number().int().min(1),
  payload: z.object({
    id: z.string().uuid(),
    clientId: z.string().uuid(),
    url: z.string().url(),
    canonicalUrl: z.string().url(),
    sourceType: discoverySourceTypeSchema,
    identifier: z.string(),
    createdAt: z.string(),
  }),
})

export type DiscoverySourceCreatedEvent = z.infer<typeof discoverySourceCreatedEventSchema>

// Currently only one discovery event type exists; export scalar schema for now.
// When adding new events, convert to z.union([...schemas]) at that time.
export const discoveryEventEnvelopeSchema = discoverySourceCreatedEventSchema

export type DiscoveryEventEnvelope = z.infer<typeof discoveryEventEnvelopeSchema>
