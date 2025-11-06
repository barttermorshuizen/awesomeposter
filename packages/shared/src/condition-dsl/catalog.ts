import { defaultAllowedOperatorsForType } from './engine.js'
import type {
  ConditionVariableCatalog,
  ConditionVariableDefinition,
  ConditionVariableType,
} from './types.js'
import { getFacetCatalog } from '../flex/facets/catalog.js'
import type { JsonSchemaShape } from '../flex/types.js'

interface CatalogEntryInput {
  id: string
  path: string
  label: string
  group?: string
  type: ConditionVariableType
  description?: string
  example?: unknown
  allowedOperators?: ConditionVariableDefinition['allowedOperators']
  dslPath?: string
}

const FACET_BASE_PATH = 'metadata.runContextSnapshot.facets'

const staticEntries: readonly CatalogEntryInput[] = [
  {
    id: 'run.latencyMs',
    path: 'run.latencyMs',
    label: 'Run · Latency (ms)',
    group: 'Runtime Signals',
    type: 'number',
    description: 'Total elapsed time in milliseconds for the planner run.',
    example: 1280,
  },
  {
    id: 'run.revisionCount',
    path: 'run.revisionCount',
    label: 'Run · Revisions Count',
    group: 'Runtime Signals',
    type: 'number',
    description: 'Number of revisions requested during the run.',
    example: 2,
  },
  {
    id: 'run.requiresHitl',
    path: 'run.requiresHitl',
    label: 'Run · Requires HITL',
    group: 'Runtime Signals',
    type: 'boolean',
    description: 'True when the run is waiting on a human-in-the-loop response.',
    example: false,
  },
] as const

type SchemaLike = JsonSchemaShape & {
  type?: string | string[]
  properties?: Record<string, JsonSchemaShape>
  items?: JsonSchemaShape | JsonSchemaShape[]
  enum?: unknown[]
  anyOf?: JsonSchemaShape[]
  oneOf?: JsonSchemaShape[]
  allOf?: JsonSchemaShape[]
  description?: string
  examples?: unknown[]
  example?: unknown
  title?: string
}

type DefinitionMap = Map<string, ConditionVariableDefinition>

type CollectorContext = {
  facetTitle: string
  description?: string
  basePath: string
  dslBaseSegments: string[]
  legacyDslBaseSegments: string[]
  pathSegments: string[]
  labelSegments: string[]
}

type ResolvedSchemaType =
  | { kind: ConditionVariableType }
  | { kind: 'object' }
  | { kind: 'array' }
  | { kind: 'unknown' }

export const conditionVariableCatalog: ConditionVariableCatalog = {
  variables: buildConditionVariableDefinitions(),
}

export function buildCatalogLookup(): Map<string, ConditionVariableDefinition> {
  const map = new Map<string, ConditionVariableDefinition>()
  for (const variable of conditionVariableCatalog.variables) {
    map.set(variable.path, variable)
  }
  return map
}

function buildConditionVariableDefinitions(): ConditionVariableDefinition[] {
  const definitions: DefinitionMap = new Map()

  for (const entry of staticEntries) {
    addDefinition(definitions, toDefinition(entry))
  }

  for (const definition of buildFacetDefinitions()) {
    addDefinition(definitions, definition)
  }

  return Array.from(definitions.values()).sort((a, b) => a.path.localeCompare(b.path))
}

function toDefinition(entry: CatalogEntryInput): ConditionVariableDefinition {
  return {
    ...entry,
    dslPath: entry.dslPath ?? entry.path,
    allowedOperators: entry.allowedOperators ?? defaultAllowedOperatorsForType(entry.type),
  }
}

function addDefinition(map: DefinitionMap, definition: ConditionVariableDefinition): void {
  if (!map.has(definition.path)) {
    map.set(definition.path, definition)
  }
}

function buildFacetDefinitions(): ConditionVariableDefinition[] {
  const catalog = getFacetCatalog()
  const results: DefinitionMap = new Map()

  for (const facet of catalog.list()) {
    const basePath = `${FACET_BASE_PATH}.${facet.name}.value`
    const dslBaseSegments = ['facets', facet.name]
    const legacyDslBaseSegments = ['facets', facet.name, 'value']
    const facetTitle = facet.title?.trim().length ? facet.title.trim() : formatSegment(facet.name)
    const facetDescription =
      typeof facet.description === 'string' && facet.description.trim().length
        ? facet.description.trim()
        : undefined

    collectSchemaDefinitions(
      facet.schema as SchemaLike,
      {
        facetTitle,
        description: facetDescription,
        basePath,
        dslBaseSegments,
        legacyDslBaseSegments,
        pathSegments: [],
        labelSegments: [],
      },
      results,
    )
  }

  return Array.from(results.values())
}

function collectSchemaDefinitions(
  schema: SchemaLike | undefined,
  context: CollectorContext,
  definitions: DefinitionMap,
): void {
  if (!schema) return

  const expansionSchemas = [
    ...(Array.isArray(schema.allOf) ? schema.allOf : []),
    ...(Array.isArray(schema.anyOf) ? schema.anyOf : []),
    ...(Array.isArray(schema.oneOf) ? schema.oneOf : []),
  ]
  for (const candidate of expansionSchemas) {
    collectSchemaDefinitions(candidate as SchemaLike, context, definitions)
  }

  const resolved = resolveSchemaType(schema)
  switch (resolved.kind) {
    case 'object': {
      const properties = schema.properties ?? {}
      const keys = Object.keys(properties)
      if (!keys.length) return

      for (const key of keys) {
        const propertySchema = properties[key] as SchemaLike
        const nextContext: CollectorContext = {
          facetTitle: context.facetTitle,
          description:
            typeof propertySchema.description === 'string' && propertySchema.description.trim().length
              ? propertySchema.description.trim()
              : context.description,
          basePath: context.basePath,
          dslBaseSegments: context.dslBaseSegments,
          legacyDslBaseSegments: context.legacyDslBaseSegments,
          pathSegments: [...context.pathSegments, key],
          labelSegments: [
            ...context.labelSegments,
            propertySchema.title && propertySchema.title.trim().length
              ? propertySchema.title.trim()
              : formatSegment(key),
          ],
        }
        collectSchemaDefinitions(propertySchema, nextContext, definitions)
      }
      return
    }
    case 'array': {
      registerFacetDefinition(schema, context, 'array', definitions)
      const items = schema.items
      if (items && !Array.isArray(items)) {
        collectSchemaDefinitions(items as SchemaLike, context, definitions)
      }
      return
    }
    case 'string':
    case 'number':
    case 'boolean': {
      registerFacetDefinition(schema, context, resolved.kind, definitions)
      return
    }
    default:
      return
  }
}

function registerFacetDefinition(
  schema: SchemaLike,
  context: CollectorContext,
  type: ConditionVariableType,
  definitions: DefinitionMap,
): void {
  const path = buildPath(context.basePath, context.pathSegments)
  const dslPath = buildDslPath(context.dslBaseSegments, context.pathSegments)
  const legacyDslPath = buildDslPath(context.legacyDslBaseSegments, context.pathSegments)
  const label = buildLabel(context.facetTitle, context.labelSegments)
  const description =
    typeof schema.description === 'string' && schema.description.trim().length
      ? schema.description.trim()
      : context.description
  const example = extractExample(schema)

  const aliases: string[] = []
  if (legacyDslPath !== dslPath) {
    aliases.push(legacyDslPath)
  }

  const definition: ConditionVariableDefinition = {
    id: path,
    path,
    dslPath,
    ...(aliases.length ? { aliases } : {}),
    label,
    group: context.facetTitle,
    type,
    description,
    allowedOperators: defaultAllowedOperatorsForType(type),
    ...(example !== undefined ? { example } : {}),
  }

  addDefinition(definitions, definition)
}

function buildPath(basePath: string, segments: string[]): string {
  if (!segments.length) {
    return basePath
  }
  return `${basePath}.${segments.join('.')}`
}

function buildDslPath(baseSegments: string[], segments: string[]): string {
  const parts = [...baseSegments]
  if (segments.length) {
    parts.push(...segments)
  }
  return parts.join('.')
}

function buildLabel(facetTitle: string, segments: string[]): string {
  if (!segments.length) {
    return facetTitle
  }
  return `${facetTitle} · ${segments.join(' · ')}`
}

function extractExample(schema: SchemaLike): unknown {
  if (Array.isArray(schema.examples) && schema.examples.length > 0) {
    return schema.examples[0]
  }
  if (schema.example !== undefined) {
    return schema.example
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum[0]
  }
  return undefined
}

function resolveSchemaType(schema: SchemaLike): ResolvedSchemaType {
  const rawTypes = normaliseTypes(schema.type)
  if (!rawTypes.length) {
    if (schema.properties) {
      return { kind: 'object' }
    }
    if (schema.items) {
      return { kind: 'array' }
    }
    if (Array.isArray(schema.enum) && schema.enum.length > 0) {
      return inferTypeFromValue(schema.enum[0])
    }
    return { kind: 'unknown' }
  }

  if (rawTypes.includes('object')) {
    return { kind: 'object' }
  }
  if (rawTypes.includes('array')) {
    return { kind: 'array' }
  }
  if (rawTypes.includes('number') || rawTypes.includes('integer')) {
    return { kind: 'number' }
  }
  if (rawTypes.includes('boolean')) {
    return { kind: 'boolean' }
  }
  if (rawTypes.includes('string')) {
    return { kind: 'string' }
  }

  if (schema.properties) {
    return { kind: 'object' }
  }
  if (schema.items) {
    return { kind: 'array' }
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return inferTypeFromValue(schema.enum[0])
  }
  return { kind: 'unknown' }
}

function normaliseTypes(type: SchemaLike['type']): string[] {
  if (!type) return []
  if (typeof type === 'string') {
    return type === 'null' ? [] : [type]
  }
  return type.filter((entry) => entry !== 'null')
}

function inferTypeFromValue(value: unknown): ResolvedSchemaType {
  if (value === null || value === undefined) {
    return { kind: 'unknown' }
  }
  if (Array.isArray(value)) {
    return { kind: 'array' }
  }
  switch (typeof value) {
    case 'number':
      return { kind: 'number' }
    case 'boolean':
      return { kind: 'boolean' }
    case 'string':
      return { kind: 'string' }
    default:
      return { kind: 'unknown' }
  }
}

function formatSegment(segment: string): string {
  const expanded = segment
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(' ')
    .filter(Boolean)

  return expanded
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}
