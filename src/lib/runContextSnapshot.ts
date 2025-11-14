type SnapshotRecord = Record<string, unknown>

export type RunContextFacetEntry = {
  value: unknown
  updatedAt?: string
  provenance?: unknown
}

const RESERVED_KEYS = new Set([
  'facets',
  'facetProvenance',
  'hitlClarifications',
  'clarifications',
  'expectedInputFacets',
  'expectedOutputFacets',
  'currentInputs',
  'currentInput',
  'currentOutputs',
  'currentOutput',
  'assignment',
  'metadata',
  'context'
])

function isRecord(value: unknown): value is SnapshotRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeFacetEntry(entry: unknown): RunContextFacetEntry | null {
  if (isRecord(entry) && 'value' in entry) {
    return entry as RunContextFacetEntry
  }
  if (entry === undefined || entry === null) {
    return null
  }
  return { value: entry }
}

export function collectRunContextFacetEntries(snapshot: unknown): Record<string, RunContextFacetEntry> {
  if (!isRecord(snapshot)) return {}

  const entries: Record<string, RunContextFacetEntry> = {}
  const facets = snapshot.facets
  if (isRecord(facets)) {
    for (const [facet, entry] of Object.entries(facets)) {
      const normalized = normalizeFacetEntry(entry)
      if (normalized) {
        entries[facet] = normalized
      }
    }
  }

  for (const [key, value] of Object.entries(snapshot)) {
    if (RESERVED_KEYS.has(key)) continue
    const normalized = normalizeFacetEntry(value)
    if (normalized) {
      entries[key] = normalized
    }
  }

  return entries
}

export function getRunContextFacetEntry(snapshot: unknown, facet: string): RunContextFacetEntry | null {
  if (!facet) return null
  const entries = collectRunContextFacetEntries(snapshot)
  return entries[facet] ?? null
}

export function getRunContextFacetValue(snapshot: unknown, facet: string): unknown {
  const entry = getRunContextFacetEntry(snapshot, facet)
  if (entry) {
    return entry.value
  }
  if (isRecord(snapshot) && facet in snapshot) {
    return (snapshot as SnapshotRecord)[facet]
  }
  return undefined
}
