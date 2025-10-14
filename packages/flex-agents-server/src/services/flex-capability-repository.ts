import { type CapabilityRegistration } from '@awesomeposter/shared'
import { getDb, flexCapabilities } from '@awesomeposter/db'
import { inArray } from 'drizzle-orm'

export type FlexCapabilityRow = {
  capabilityId: string
  version: string
  displayName: string
  summary: string
  inputTraits: Record<string, unknown> | null
  inputContract: Record<string, unknown> | null
  outputContract: Record<string, unknown> | null
  inputFacets: string[] | null
  outputFacets: string[] | null
  cost: Record<string, unknown> | null
  preferredModels: string[] | null
  heartbeat: Record<string, unknown> | null
  metadata: Record<string, unknown> | null
  status: 'active' | 'inactive'
  lastSeenAt: Date | null
  registeredAt: Date | null
  createdAt: Date | null
  updatedAt: Date | null
}

export interface FlexCapabilityRepository {
  upsert(payload: CapabilityRegistration, timestamps: { now: Date }, facets: { input: string[]; output: string[] }): Promise<void>
  list(): Promise<FlexCapabilityRow[]>
  markInactive(ids: string[], timestamp: Date): Promise<void>
}

export class DatabaseFlexCapabilityRepository implements FlexCapabilityRepository {
  constructor(private readonly db = getDb()) {}

  async upsert(
    payload: CapabilityRegistration,
    { now }: { now: Date },
    facets: { input: string[]; output: string[] }
  ): Promise<void> {
    const base = {
      capabilityId: payload.capabilityId,
      version: payload.version,
      displayName: payload.displayName,
      summary: payload.summary,
      inputTraitsJson: (payload.inputTraits ?? null) as any,
      inputContractJson: (payload.inputContract ?? null) as any,
      outputContractJson: (payload.outputContract ?? null) as any,
      inputFacets: facets.input,
      outputFacets: facets.output,
      costJson: (payload.cost ?? null) as any,
      preferredModels: payload.preferredModels ?? [],
      heartbeatJson: (payload.heartbeat ?? null) as any,
      metadataJson: (payload.metadata ?? null) as any,
      status: 'active' as const,
      lastSeenAt: now,
      updatedAt: now,
      registeredAt: now
    }

    await this.db
      .insert(flexCapabilities)
      .values(base)
      .onConflictDoUpdate({
        target: flexCapabilities.capabilityId,
        set: {
          version: payload.version,
          displayName: payload.displayName,
          summary: payload.summary,
          inputTraitsJson: (payload.inputTraits ?? null) as any,
          inputContractJson: (payload.inputContract ?? null) as any,
          outputContractJson: (payload.outputContract ?? null) as any,
          inputFacets: facets.input,
          outputFacets: facets.output,
          costJson: (payload.cost ?? null) as any,
          preferredModels: payload.preferredModels ?? [],
          heartbeatJson: (payload.heartbeat ?? null) as any,
          metadataJson: (payload.metadata ?? null) as any,
          status: 'active',
          lastSeenAt: now,
          updatedAt: now
        }
      })
  }

  async list(): Promise<FlexCapabilityRow[]> {
    const rows = await this.db.select().from(flexCapabilities)
    return rows.map((row) => ({
      capabilityId: row.capabilityId,
      version: row.version,
      displayName: row.displayName,
      summary: row.summary,
      inputTraits: (row.inputTraitsJson ?? null) as any,
      inputContract: (row.inputContractJson ?? null) as any,
      outputContract: (row.outputContractJson ?? null) as any,
      inputFacets: row.inputFacets ?? null,
      outputFacets: row.outputFacets ?? null,
      cost: (row.costJson ?? null) as any,
      preferredModels: row.preferredModels ?? null,
      heartbeat: (row.heartbeatJson ?? null) as any,
      metadata: (row.metadataJson ?? null) as any,
      status: (row.status as 'active' | 'inactive') ?? 'inactive',
      lastSeenAt: row.lastSeenAt ?? null,
      registeredAt: row.registeredAt ?? null,
      createdAt: row.createdAt ?? null,
      updatedAt: row.updatedAt ?? null
    }))
  }

  async markInactive(ids: string[], timestamp: Date): Promise<void> {
    if (!ids.length) return
    await this.db
      .update(flexCapabilities)
      .set({ status: 'inactive', updatedAt: timestamp })
      .where(inArray(flexCapabilities.capabilityId, ids))
  }
}
