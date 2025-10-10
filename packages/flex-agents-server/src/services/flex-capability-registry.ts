import { CapabilityRecord, CapabilityRegistration } from '@awesomeposter/shared'
import { getLogger } from './logger'
import {
  DatabaseFlexCapabilityRepository,
  type FlexCapabilityRepository,
  type FlexCapabilityRow
} from './flex-capability-repository'

type CapabilitySnapshot = {
  active: CapabilityRecord[]
  all: CapabilityRecord[]
}

function determineTimeoutSeconds(record: CapabilityRecord): number | null {
  const heartbeat = record.heartbeat
  if (!heartbeat) return null
  if (heartbeat.timeoutSeconds && Number.isFinite(heartbeat.timeoutSeconds)) return heartbeat.timeoutSeconds
  if (heartbeat.intervalSeconds && Number.isFinite(heartbeat.intervalSeconds)) return heartbeat.intervalSeconds * 3
  return null
}

function isRecordExpired(record: CapabilityRecord, reference: Date): boolean {
  const timeoutSeconds = determineTimeoutSeconds(record)
  if (!timeoutSeconds) return false
  const lastSeenIso = record.lastSeenAt || record.registeredAt
  if (!lastSeenIso) return false
  const lastSeen = new Date(lastSeenIso)
  if (Number.isNaN(lastSeen.getTime())) return false
  const diffSeconds = (reference.getTime() - lastSeen.getTime()) / 1000
  return diffSeconds > timeoutSeconds
}

export class FlexCapabilityRegistryService {
  private cache: { snapshot: CapabilitySnapshot; expiresAt: number } | null = null
  private loading: Promise<CapabilitySnapshot> | null = null
  private readonly cacheTtlMs: number
  private readonly nowProvider: () => Date

  constructor(
    private readonly repository: FlexCapabilityRepository = new DatabaseFlexCapabilityRepository(),
    options?: { cacheTtlMs?: number; now?: () => Date }
  ) {
    this.cacheTtlMs = options?.cacheTtlMs ?? Number(process.env.FLEX_CAPABILITY_CACHE_TTL_MS || 5000)
    this.nowProvider = options?.now ?? (() => new Date())
  }

  invalidate() {
    this.cache = null
  }

  async register(payload: CapabilityRegistration): Promise<CapabilityRecord> {
    const now = this.nowProvider()
    await this.repository.upsert(payload, { now })
    this.invalidate()
    const record = await this.getCapabilityById(payload.capabilityId)
    if (!record) {
      throw new Error(`Capability ${payload.capabilityId} failed to register`)
    }
    try {
      getLogger().info('flex_capability_registered', {
        capabilityId: record.capabilityId,
        status: record.status,
        version: record.version
      })
    } catch {}
    return record
  }

  async listActive(): Promise<CapabilityRecord[]> {
    const snapshot = await this.loadSnapshot()
    return snapshot.active
  }

  async getCapabilityById(capabilityId: string): Promise<CapabilityRecord | undefined> {
    const snapshot = await this.loadSnapshot()
    return snapshot.all.find((entry) => entry.capabilityId === capabilityId)
  }

  async getSnapshot(): Promise<CapabilitySnapshot> {
    return this.loadSnapshot()
  }

  private async loadSnapshot(force = false): Promise<CapabilitySnapshot> {
    const now = Date.now()
    if (!force && this.cache && now < this.cache.expiresAt) {
      return this.cache.snapshot
    }
    if (this.loading) {
      return this.loading
    }
    this.loading = this.fetchSnapshot()
    try {
      const snapshot = await this.loading
      this.cache = { snapshot, expiresAt: Date.now() + Math.max(this.cacheTtlMs, 0) }
      return snapshot
    } finally {
      this.loading = null
    }
  }

  private async fetchSnapshot(): Promise<CapabilitySnapshot> {
    const now = this.nowProvider()
    const rows = await this.repository.list()
    const inactiveDueToTimeout: string[] = []

    const all = rows.map((row) => this.mapRow(row))
    const adjusted = all.map((record) => {
      const expired = isRecordExpired(record, now)
      if (expired && record.status !== 'inactive') {
        inactiveDueToTimeout.push(record.capabilityId)
      }
      return expired ? { ...record, status: 'inactive' as const } : record
    })

    if (inactiveDueToTimeout.length > 0) {
      await this.repository.markInactive(inactiveDueToTimeout, now)
      try {
        getLogger().info('flex_capability_marked_inactive', {
          capabilityIds: inactiveDueToTimeout,
          reason: 'heartbeat_timeout'
        })
      } catch {}
    }

    const active = adjusted.filter((record) => record.status === 'active')
    return { active, all: adjusted }
  }

  private mapRow(row: FlexCapabilityRow): CapabilityRecord {
    const lastSeen = row.lastSeenAt ? row.lastSeenAt.toISOString() : undefined
    const registeredAt = row.registeredAt ? row.registeredAt.toISOString() : undefined
    const heartbeat = (row.heartbeat ?? undefined) as CapabilityRecord['heartbeat']
    const preferredModels = row.preferredModels && row.preferredModels.length ? row.preferredModels : undefined
    return {
      capabilityId: row.capabilityId,
      version: row.version,
      displayName: row.displayName,
      summary: row.summary,
      inputTraits: (row.inputTraits ?? undefined) as CapabilityRecord['inputTraits'],
      defaultContract: (row.defaultContract ?? undefined) as CapabilityRecord['defaultContract'],
      cost: (row.cost ?? undefined) as CapabilityRecord['cost'],
      preferredModels,
      heartbeat,
      metadata: (row.metadata ?? undefined) as CapabilityRecord['metadata'],
      status: row.status,
      lastSeenAt: lastSeen,
      registeredAt
    }
  }
}

let singleton: FlexCapabilityRegistryService | null = null

export function getFlexCapabilityRegistryService(): FlexCapabilityRegistryService {
  if (!singleton) {
    singleton = new FlexCapabilityRegistryService()
  }
  return singleton
}

export function setFlexCapabilityRegistryService(service: FlexCapabilityRegistryService | null) {
  singleton = service
}

export function resetFlexCapabilityRegistryService() {
  singleton = null
}
