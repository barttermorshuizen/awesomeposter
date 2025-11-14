import {
  CapabilityContract,
  CapabilityPostConditionMetadata,
  CapabilityRecord,
  CapabilityRegistration,
  FacetContractCompiler,
  FacetContractError,
  JsonSchemaContract,
  TaskEnvelope,
  TaskPolicies,
  GoalConditionResult,
  FacetCondition,
  FlexCrcsSnapshot,
  FlexCrcsCapabilityEntry,
  FlexCrcsReasonCode,
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

type CrcsGraphContext = {
  completedNodes?: Array<{ outputFacets?: string[] | null }>
  facetValues?: Array<{ facet: string }>
}

type ComputeCrcsSnapshotInput = {
  envelope: TaskEnvelope
  policies: TaskPolicies
  capabilities?: CapabilityRecord[]
  graphContext?: CrcsGraphContext
  goalConditions?: FacetCondition[]
  goalConditionFailures?: GoalConditionResult[]
  availableFacetHints?: string[]
  pinnedCapabilities?: string[]
  maxRows?: number
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

  async computeCrcsSnapshot(input: ComputeCrcsSnapshotInput): Promise<FlexCrcsSnapshot> {
    const snapshot = input.capabilities ?? (await this.getSnapshot()).active
    const capabilities = snapshot.slice()
    if (capabilities.length === 0) {
      return {
        rows: [],
        totalRows: 0,
        mrcsSize: 0,
        reasonCounts: {},
        rowCap: input.maxRows,
        pinnedCapabilityIds: [],
        mrcsCapabilityIds: [],
        missingPinnedCapabilityIds: []
      }
    }

    const rowCapEnv = Number(process.env.FLEX_PLANNER_CRCS_MAX_ROWS ?? 80)
    const resolvedRowCap = input.maxRows && Number.isFinite(input.maxRows) ? input.maxRows : rowCapEnv
    const rowCap = Math.max(1, resolvedRowCap || 1)

    const capabilityEntries = capabilities.map((capability, index) => {
      const inputs = this.getCapabilityFacets(capability, 'input')
      const outputs = this.getCapabilityFacets(capability, 'output')
      return { capability, index, inputs, outputs }
    })
    const facetToConsumers = new Map<string, string[]>()
    const facetToProducers = new Map<string, string[]>()
    capabilityEntries.forEach((entry) => {
      entry.inputs.forEach((facet) => {
        const bucket = facetToConsumers.get(facet) ?? []
        bucket.push(entry.capability.capabilityId)
        facetToConsumers.set(facet, bucket)
      })
      entry.outputs.forEach((facet) => {
        const bucket = facetToProducers.get(facet) ?? []
        bucket.push(entry.capability.capabilityId)
        facetToProducers.set(facet, bucket)
      })
    })

    const { pinnedFromPolicies, pinnedFromGoalConditions, missingPinned } = this.collectPinnedCapabilities({
      policies: input.policies,
      goalConditions: input.goalConditions,
      goalConditionFailures: input.goalConditionFailures,
      facetToCapabilities: facetToProducers
    })
    const explicitPins = new Set<string>(input.pinnedCapabilities ?? [])
    pinnedFromPolicies.forEach((id) => explicitPins.add(id))
    pinnedFromGoalConditions.forEach((id) => explicitPins.add(id))

    const startFacets = this.resolveStartFacets(input.envelope, input.graphContext, input.availableFacetHints)
    const targetFacets = this.resolveTargetFacets(input.envelope, input.goalConditions)

    const forwardCaps = this.resolveForwardReachableCaps(startFacets, facetToConsumers, capabilityEntries)
    const backwardCaps = this.resolveBackwardReachableCaps(targetFacets, facetToProducers, capabilityEntries)
    const pathCaps = new Set<string>()
    forwardCaps.forEach((id) => {
      if (backwardCaps.has(id)) {
        pathCaps.add(id)
      }
    })

    const reasonMap = new Map<string, Set<FlexCrcsReasonCode>>()
    const addReason = (capabilityId: string, reason: FlexCrcsReasonCode) => {
      if (!pathCaps.has(capabilityId)) return
      const bucket = reasonMap.get(capabilityId) ?? new Set<FlexCrcsReasonCode>()
      bucket.add(reason)
      reasonMap.set(capabilityId, bucket)
    }

    pathCaps.forEach((capabilityId) => addReason(capabilityId, 'path'))

    const pinnedCapabilityIds: string[] = []
    const missingPinnedCapabilityIds = new Set<string>(missingPinned)
    for (const capabilityId of explicitPins) {
      if (pathCaps.has(capabilityId)) {
        addReason(capabilityId, pinnedFromPolicies.has(capabilityId) ? 'policy_reference' : 'goal_condition')
        pinnedCapabilityIds.push(capabilityId)
      } else {
        missingPinnedCapabilityIds.add(capabilityId)
      }
    }

    const allRows = this.buildCrcsRows(capabilityEntries, reasonMap, pathCaps)
    const { rows, truncated } = this.enforceRowCap(allRows, pathCaps.size, rowCap)
    const reasonCounts = this.buildReasonCounts(rows)

    return {
      rows,
      totalRows: rows.length,
      mrcsSize: pathCaps.size,
      reasonCounts,
      rowCap,
      truncated,
      pinnedCapabilityIds,
      mrcsCapabilityIds: Array.from(pathCaps),
      missingPinnedCapabilityIds: Array.from(missingPinnedCapabilityIds)
    }
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
    const metadataWithGuards = this.appendPostConditionMetadata(metadata, row.postConditionMetadata)

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
    const postConditions =
      row.postConditionMetadata && row.postConditionMetadata.conditions.length
        ? (row.postConditionMetadata.conditions as CapabilityRecord['postConditions'])
        : undefined
    return {
      capabilityId: row.capabilityId,
      version: row.version,
      displayName: row.displayName,
      summary: row.summary,
      kind: row.kind ?? 'execution',
      inputTraits: (row.inputTraits ?? undefined) as CapabilityRecord['inputTraits'],
      inputContract,
      outputContract,
      cost: (row.cost ?? undefined) as CapabilityRecord['cost'],
      preferredModels,
      heartbeat,
      agentType: row.agentType ?? 'ai',
      instructionTemplates,
      assignmentDefaults,
      metadata: metadataWithGuards as CapabilityRecord['metadata'],
      postConditions,
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

  private appendPostConditionMetadata(
    metadata: CapabilityRecord['metadata'],
    postConditionMetadata: CapabilityPostConditionMetadata | null
  ): CapabilityRecord['metadata'] {
    if (!postConditionMetadata || !postConditionMetadata.guards.length) {
      return metadata
    }
    const base =
      metadata && typeof metadata === 'object'
        ? { ...(metadata as Record<string, unknown>) }
        : ({} as Record<string, unknown>)
    base.postConditionGuards = postConditionMetadata.guards
    return base
  }

  private resolveStartFacets(
    envelope: TaskEnvelope,
    graphContext?: CrcsGraphContext,
    hints?: string[]
  ): Set<string> {
    const facets = new Set<string>()
    if (envelope.inputs && typeof envelope.inputs === 'object') {
      Object.keys(envelope.inputs).forEach((key) => facets.add(key))
    }
    if (Array.isArray(hints)) {
      hints.filter((facet): facet is string => typeof facet === 'string' && facet.length > 0).forEach((facet) => facets.add(facet))
    }
    if (graphContext?.completedNodes) {
      graphContext.completedNodes.forEach((node) => {
        const outputs = Array.isArray(node.outputFacets) ? node.outputFacets : []
        outputs.forEach((facet) => facets.add(facet))
      })
    }
    if (graphContext?.facetValues) {
      graphContext.facetValues.forEach((entry) => {
        if (entry?.facet) facets.add(entry.facet)
      })
    }
    return facets
  }

  private resolveTargetFacets(envelope: TaskEnvelope, goalConditions?: FacetCondition[]): Set<string> {
    const facets = new Set<string>()
    if (envelope.outputContract?.mode === 'facets') {
      (envelope.outputContract.facets ?? []).forEach((facet) => facets.add(facet))
    }
    goalConditions?.forEach((condition) => {
      if (condition?.facet) facets.add(condition.facet)
    })
    return facets
  }

  private resolveForwardReachableCaps(
    startFacets: Set<string>,
    facetToConsumers: Map<string, string[]>,
    capabilityEntries: Array<{ capability: CapabilityRecord; inputs: string[]; outputs: string[] }>
  ): Set<string> {
    const queue: string[] = Array.from(startFacets)
    const visitedFacets = new Set(queue)
    const reachableCaps = new Set<string>()
    const capabilityMap = new Map(capabilityEntries.map((entry) => [entry.capability.capabilityId, entry]))
    const remainingInputs = new Map<string, number>()

    const activateCapability = (capabilityId: string) => {
      if (reachableCaps.has(capabilityId)) {
        return
      }
      const entry = capabilityMap.get(capabilityId)
      if (!entry) return
      reachableCaps.add(capabilityId)
      entry.outputs.forEach((nextFacet) => {
        if (!visitedFacets.has(nextFacet)) {
          visitedFacets.add(nextFacet)
          queue.push(nextFacet)
        }
      })
    }

    capabilityEntries.forEach((entry) => {
      const uniqueInputs = Array.from(new Set(entry.inputs))
      remainingInputs.set(entry.capability.capabilityId, uniqueInputs.length)
      if (uniqueInputs.length === 0) {
        activateCapability(entry.capability.capabilityId)
      }
    })

    while (queue.length) {
      const facet = queue.shift()!
      const consumers = facetToConsumers.get(facet) ?? []
      for (const capabilityId of consumers) {
        const remaining = remainingInputs.get(capabilityId)
        if (remaining === undefined) continue
        if (remaining <= 0) {
          activateCapability(capabilityId)
          continue
        }
        const nextRemaining = remaining - 1
        remainingInputs.set(capabilityId, nextRemaining)
        if (nextRemaining <= 0) {
          activateCapability(capabilityId)
        }
      }
    }
    return reachableCaps
  }

  private resolveBackwardReachableCaps(
    targetFacets: Set<string>,
    facetToProducers: Map<string, string[]>,
    capabilityEntries: Array<{ capability: CapabilityRecord; inputs: string[]; outputs: string[] }>
  ): Set<string> {
    const queue: string[] = Array.from(targetFacets)
    const visitedFacets = new Set(queue)
    const reachableCaps = new Set<string>()
    const capabilityMap = new Map(capabilityEntries.map((entry) => [entry.capability.capabilityId, entry]))

    while (queue.length) {
      const facet = queue.shift()!
      const producers = facetToProducers.get(facet) ?? []
      for (const capabilityId of producers) {
        if (reachableCaps.has(capabilityId)) continue
        reachableCaps.add(capabilityId)
        const entry = capabilityMap.get(capabilityId)
        if (!entry) continue
        for (const nextFacet of entry.inputs) {
          if (!visitedFacets.has(nextFacet)) {
            visitedFacets.add(nextFacet)
            queue.push(nextFacet)
          }
        }
      }
    }
    return reachableCaps
  }

  private collectPinnedCapabilities(params: {
    policies: TaskPolicies
    goalConditions?: FacetCondition[]
    goalConditionFailures?: GoalConditionResult[]
    facetToCapabilities: Map<string, string[]>
  }): {
    pinnedFromPolicies: Set<string>
    pinnedFromGoalConditions: Set<string>
    missingPinned: string[]
  } {
    const pinnedFromPolicies = new Set<string>()
    const plannerSelection = params.policies.planner?.selection
    if (plannerSelection?.require?.length) {
      plannerSelection.require.forEach((capabilityId) => pinnedFromPolicies.add(capabilityId))
    }
    params.policies.runtime.forEach((policy) => {
      const capabilityId = policy.trigger?.selector?.capabilityId
      if (capabilityId) pinnedFromPolicies.add(capabilityId)
    })

    const pinnedFromGoalConditions = new Set<string>()
    const missingPinned: string[] = []
    const registerFacet = (facet: string | undefined) => {
      if (!facet) return
      const owners = params.facetToCapabilities.get(facet)
      if (!owners || owners.length === 0) {
        missingPinned.push(`facet:${facet}`)
        return
      }
      owners.forEach((capabilityId) => pinnedFromGoalConditions.add(capabilityId))
    }

    params.goalConditions?.forEach((condition) => registerFacet(condition.facet))
    params.goalConditionFailures?.forEach((failure) => registerFacet(failure.facet))

    return {
      pinnedFromPolicies,
      pinnedFromGoalConditions,
      missingPinned
    }
  }

  private buildCrcsRows(
    capabilityEntries: Array<{ capability: CapabilityRecord; index: number }>,
    reasonMap: Map<string, Set<FlexCrcsReasonCode>>,
    pathCaps: Set<string>
  ) {
    const rows: FlexCrcsCapabilityEntry[] = []
    capabilityEntries.forEach((entry) => {
      if (!pathCaps.has(entry.capability.capabilityId)) return
      const reasons = reasonMap.get(entry.capability.capabilityId)
      if (!reasons || reasons.size === 0) return
      rows.push({
        capabilityId: entry.capability.capabilityId,
        displayName: entry.capability.displayName,
        kind: entry.capability.kind,
        inputFacets: this.getCapabilityFacets(entry.capability, 'input'),
        outputFacets: this.getCapabilityFacets(entry.capability, 'output'),
        postConditions: this.summarizePostConditions(entry.capability),
        reasonCodes: Array.from(reasons),
        source: 'mrcs'
      })
    })
    return rows
  }

  private enforceRowCap(
    rows: FlexCrcsCapabilityEntry[],
    _mrcsSize: number,
    rowCap: number
  ): { rows: FlexCrcsCapabilityEntry[]; truncated: boolean } {
    if (rows.length <= rowCap) {
      return { rows, truncated: false }
    }
    return {
      rows: rows.slice(0, rowCap),
      truncated: true
    }
  }

  private buildReasonCounts(rows: FlexCrcsCapabilityEntry[]): Record<string, number> {
    const counts: Record<string, number> = {}
    rows.forEach((row) => {
      row.reasonCodes.forEach((reason) => {
        counts[reason] = (counts[reason] ?? 0) + 1
      })
    })
    return counts
  }

  private getCapabilityFacets(capability: CapabilityRecord, direction: 'input' | 'output'): string[] {
    const declared = direction === 'input' ? capability.inputFacets : capability.outputFacets
    if (declared && declared.length) {
      return Array.from(new Set(declared))
    }
    const contract = direction === 'input' ? capability.inputContract : capability.outputContract
    if (contract?.mode === 'facets') {
      return Array.from(new Set(contract.facets ?? []))
    }
    return []
  }

  private summarizePostConditions(
    capability: CapabilityRecord
  ): Array<{ facet: string; path: string; expression: string }> {
    if (!capability.postConditions || capability.postConditions.length === 0) {
      return []
    }
    return capability.postConditions.map((condition) => ({
      facet: condition.facet,
      path: condition.path,
      expression:
        typeof condition.condition.canonicalDsl === 'string' && condition.condition.canonicalDsl.length
          ? condition.condition.canonicalDsl
          : condition.condition.dsl
    }))
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
