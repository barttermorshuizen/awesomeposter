import {
  CapabilityContract,
  CapabilityRecord,
  CapabilityRegistration,
  FacetContractCompiler,
  FacetContractError,
  JsonSchemaContract,
  type CompiledFacetSchema
} from '@awesomeposter/shared'
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
  private readonly facetCompiler: FacetContractCompiler

  constructor(
    private readonly repository: FlexCapabilityRepository = new DatabaseFlexCapabilityRepository(),
    options?: { cacheTtlMs?: number; now?: () => Date; facetCompiler?: FacetContractCompiler }
  ) {
    this.cacheTtlMs = options?.cacheTtlMs ?? Number(process.env.FLEX_CAPABILITY_CACHE_TTL_MS || 5000)
    this.nowProvider = options?.now ?? (() => new Date())
    this.facetCompiler = options?.facetCompiler ?? new FacetContractCompiler()
  }

  invalidate() {
    this.cache = null
  }

  async register(payload: CapabilityRegistration): Promise<CapabilityRecord> {
    const now = this.nowProvider()
    const { registration, facets } = this.prepareRegistration(payload)
    await this.repository.upsert(registration, { now }, facets)
    this.invalidate()
    const record = await this.getCapabilityById(registration.capabilityId)
    if (!record) {
      throw new Error(`Capability ${registration.capabilityId} failed to register`)
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
    const inputFacets = row.inputFacets ?? []
    const outputFacets = row.outputFacets ?? []
    const metadata = this.mergeMetadata(row.metadata, inputFacets, outputFacets)

    const instructionTemplates =
      row.instructionTemplates && Object.keys(row.instructionTemplates).length
        ? (row.instructionTemplates as CapabilityRecord['instructionTemplates'])
        : undefined
    const assignmentDefaults =
      row.assignmentDefaults && Object.keys(row.assignmentDefaults).length
        ? (row.assignmentDefaults as CapabilityRecord['assignmentDefaults'])
        : undefined

    const lastSeen = row.lastSeenAt ? row.lastSeenAt.toISOString() : undefined
    const registeredAt = row.registeredAt ? row.registeredAt.toISOString() : undefined
    const heartbeat = (row.heartbeat ?? undefined) as CapabilityRecord['heartbeat']
    const preferredModels = row.preferredModels && row.preferredModels.length ? row.preferredModels : undefined
    const inputContract = (row.inputContract ?? undefined) as CapabilityRecord['inputContract']
    const outputContract = (row.outputContract ?? undefined) as CapabilityRecord['outputContract']
    return {
      capabilityId: row.capabilityId,
      version: row.version,
      displayName: row.displayName,
      summary: row.summary,
      inputTraits: (row.inputTraits ?? undefined) as CapabilityRecord['inputTraits'],
      inputContract,
      outputContract,
      cost: (row.cost ?? undefined) as CapabilityRecord['cost'],
      preferredModels,
      heartbeat,
      agentType: row.agentType ?? 'ai',
      instructionTemplates,
      assignmentDefaults,
      metadata: metadata as CapabilityRecord['metadata'],
      status: row.status,
      lastSeenAt: lastSeen,
      registeredAt,
      inputFacets: inputFacets.length ? inputFacets : undefined,
      outputFacets: outputFacets.length ? outputFacets : undefined
    }
  }

  private prepareRegistration(payload: CapabilityRegistration) {
    const inputFacetNames = this.extractFacetNames(payload.inputContract)
    const outputSourceContract = payload.outputContract
    const outputFacetNames = this.extractFacetNames(outputSourceContract)

    let compiledInput: JsonSchemaContract | undefined
    let compiledOutput: JsonSchemaContract | undefined
    let inputProvenance: CompiledFacetSchema['provenance'] | undefined
    let outputProvenance: CompiledFacetSchema['provenance'] | undefined

    if (inputFacetNames.length || outputFacetNames.length) {
      try {
        const compiled = this.facetCompiler.compileContracts({
          inputFacets: inputFacetNames,
          outputFacets: outputFacetNames
        })
        if (compiled.input) {
          compiledInput = this.buildJsonSchemaContract(compiled.input)
          inputProvenance = compiled.input.provenance
        }
        if (compiled.output) {
          compiledOutput = this.buildJsonSchemaContract(compiled.output)
          outputProvenance = compiled.output.provenance
        }
      } catch (error) {
        if (error instanceof FacetContractError) {
          throw new Error(
            `Capability ${payload.capabilityId} facet validation failed (${error.code}): ${error.message}`
          )
        }
        throw error
      }
    }

    const metadata = this.enrichMetadata(
      payload.metadata,
      inputFacetNames,
      outputFacetNames,
      inputProvenance,
      outputProvenance
    )

    const registration: CapabilityRegistration = {
      ...payload,
      inputContract: this.resolveContract(payload.inputContract, compiledInput),
      outputContract: this.resolveOutputContract(payload, compiledOutput),
      ...(metadata !== undefined ? { metadata } : {})
    }

    if (!registration.outputContract) {
      throw new Error(
        `Capability ${payload.capabilityId} registration is missing an output contract after facet compilation.`
      )
    }

    return {
      registration,
      facets: {
        input: inputFacetNames,
        output: outputFacetNames
      }
    }
  }

  private extractFacetNames(contract?: CapabilityContract | null): string[] {
    if (!contract) return []
    return contract.mode === 'facets' ? contract.facets : []
  }

  private resolveContract(contract: CapabilityContract | undefined, compiled?: JsonSchemaContract): CapabilityContract | undefined {
    if (!contract) {
      return compiled
    }
    if (contract.mode === 'facets') {
      return compiled
    }
    return contract
  }

  private resolveOutputContract(
    payload: CapabilityRegistration,
    compiledOutput?: JsonSchemaContract
  ): CapabilityContract | undefined {
    const originalOutput = payload.outputContract
    if (originalOutput?.mode === 'facets') {
      return compiledOutput
    }
    if (!originalOutput && compiledOutput) {
      return compiledOutput
    }
    return originalOutput
  }

  private buildJsonSchemaContract(compiled: CompiledFacetSchema): JsonSchemaContract {
    const hints = {
      ...(compiled.provenance?.length ? { facets: compiled.provenance } : {})
    }
    return {
      mode: 'json_schema',
      schema: compiled.schema,
      ...(Object.keys(hints).length ? { hints } : {})
    }
  }

  private enrichMetadata(
    metadata: CapabilityRegistration['metadata'],
    inputFacets: string[],
    outputFacets: string[],
    inputProvenance?: CompiledFacetSchema['provenance'],
    outputProvenance?: CompiledFacetSchema['provenance']
  ): CapabilityRegistration['metadata'] {
    const base =
      metadata && typeof metadata === 'object'
        ? { ...(metadata as Record<string, unknown>) }
        : ({} as Record<string, unknown>)

    const facetsEntry =
      base.facets && typeof base.facets === 'object'
        ? { ...(base.facets as Record<string, unknown>) }
        : ({} as Record<string, unknown>)
    facetsEntry.input = inputFacets
    facetsEntry.output = outputFacets
    base.facets = facetsEntry

    if (inputProvenance || outputProvenance) {
      base.facetProvenance = {
        input: inputProvenance ?? [],
        output: outputProvenance ?? []
      }
    }

    return Object.keys(base).length ? base : undefined
  }

  private mergeMetadata(
    metadata: FlexCapabilityRow['metadata'],
    inputFacets: string[],
    outputFacets: string[]
  ): CapabilityRecord['metadata'] {
    const base =
      metadata && typeof metadata === 'object'
        ? { ...(metadata as Record<string, unknown>) }
        : ({} as Record<string, unknown>)

    const facetsEntry =
      base.facets && typeof base.facets === 'object'
        ? { ...(base.facets as Record<string, unknown>) }
        : ({} as Record<string, unknown>)
    facetsEntry.input = inputFacets
    facetsEntry.output = outputFacets
    base.facets = facetsEntry

    return Object.keys(base).length ? base : undefined
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
