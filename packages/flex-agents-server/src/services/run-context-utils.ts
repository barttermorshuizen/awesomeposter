import type { FacetProvenance } from '@awesomeposter/shared'
import type { FacetSnapshot } from './run-context'

const PLANNER_METADATA_KEYS = new Set(['plannerKind', 'plannerVariantCount', 'derivedCapability'])

function safeClone<T>(value: T): T {
  if (!value || typeof value !== 'object') {
    return value
  }
  try {
    return JSON.parse(JSON.stringify(value)) as T
  } catch {
    return value
  }
}

export function stripPlannerFields(value: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value ?? null
  }
  const sanitized: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (PLANNER_METADATA_KEYS.has(key)) continue
    sanitized[key] = entry
  }
  return sanitized
}

export function extractFacetSnapshotValues(
  snapshot: FacetSnapshot | null | undefined,
  facets?: string[] | null
): Record<string, unknown> {
  if (!snapshot || typeof snapshot !== 'object') return {}
  const sourceEntries = snapshot
  const selectedFacets =
    Array.isArray(facets) && facets.length ? facets : Object.keys(sourceEntries)

  const values: Record<string, unknown> = {}
  for (const facet of selectedFacets) {
    if (typeof facet !== 'string') continue
    const entry = sourceEntries[facet]
    if (
      entry &&
      typeof entry === 'object' &&
      !Array.isArray(entry) &&
      Object.prototype.hasOwnProperty.call(entry, 'value')
    ) {
      values[facet] = safeClone((entry as { value: unknown }).value)
    }
  }
  return values
}

function resolveFacetPointer(provenance: FacetProvenance[] | undefined, facet: string): string | null {
  if (!Array.isArray(provenance)) return null
  const match = provenance.find(
    (entry) => entry.facet === facet && typeof entry.pointer === 'string' && entry.pointer.length
  )
  return match ? match.pointer : null
}

function decodeJsonPointer(pointer: string): string[] {
  if (!pointer || pointer === '/') return []
  return pointer
    .split('/')
    .slice(1)
    .map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
}

function assignValueAtPointer(target: Record<string, unknown>, pointer: string, value: unknown) {
  const segments = decodeJsonPointer(pointer)
  if (!segments.length) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(target, safeClone(value as Record<string, unknown>))
    }
    return
  }

  let current: any = target
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const isLast = index === segments.length - 1
    if (isLast) {
      if (Array.isArray(current)) {
        const idx = Number(segment)
        if (!Number.isInteger(idx)) return
        current[idx] = safeClone(value)
      } else if (current && typeof current === 'object') {
        current[segment] = safeClone(value)
      }
      return
    }

    const nextSegment = segments[index + 1]
    const expectsArray = Number.isInteger(Number(nextSegment))

    if (Array.isArray(current)) {
      const idx = Number(segment)
      if (!Number.isInteger(idx)) return
      if (!current[idx] || typeof current[idx] !== 'object') {
        current[idx] = expectsArray ? [] : {}
      }
      current = current[idx]
    } else if (current && typeof current === 'object') {
      if (!(segment in current) || typeof current[segment] !== 'object') {
        current[segment] = expectsArray ? [] : {}
      }
      current = current[segment]
    } else {
      return
    }
  }
}

function normalizeFacetStructure(base: unknown): Record<string, unknown> {
  if (!base || typeof base !== 'object' || Array.isArray(base)) {
    return {}
  }
  return safeClone(base as Record<string, unknown>)
}

export function mergeFacetValuesIntoStructure(
  base: unknown,
  additions: Record<string, unknown>,
  provenance?: FacetProvenance[] | undefined
): Record<string, unknown> {
  const target = normalizeFacetStructure(base)
  if (!additions || typeof additions !== 'object') {
    return target
  }

  for (const [facet, value] of Object.entries(additions)) {
    const pointer = resolveFacetPointer(provenance, facet) ?? `/${facet}`
    assignValueAtPointer(target, pointer, value)
  }

  return target
}

export function ensureFacetPlaceholders(
  target: Record<string, unknown> | null | undefined,
  facets: string[]
): Record<string, unknown> {
  const base = target && typeof target === 'object' && !Array.isArray(target) ? { ...target } : {}
  facets.forEach((facet) => {
    if (typeof facet !== 'string' || facet.trim().length === 0) return
    if (!(facet in base)) {
      base[facet] = null
    }
  })
  return base
}
