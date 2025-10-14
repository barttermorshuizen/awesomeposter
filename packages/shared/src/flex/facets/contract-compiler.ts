import Ajv from 'ajv'
import type { Ajv as AjvInstance, ErrorObject, Options as AjvOptions, ValidateFunction } from 'ajv'

import type { JsonSchemaShape } from '../types.js'
import type { FacetDefinition, FacetDirection } from './types.js'
import { FacetCatalog, FacetCatalogError, getFacetCatalog } from './catalog.js'

export type FacetContractCompilerOptions = {
  catalog?: FacetCatalog
  ajv?: AjvInstance
  ajvOptions?: AjvOptions
}

export type CompileFacetContractsInput = {
  inputFacets?: string[]
  outputFacets?: string[]
}

export type CompiledFacetContracts = {
  input?: CompiledFacetSchema
  output?: CompiledFacetSchema
}

export type FacetProvenance = {
  facet: string
  title: string
  direction: FacetDirection
  pointer: string
}

export type CompiledFacetSchema = {
  schema: JsonSchemaShape
  provenance: FacetProvenance[]
  validator: (payload: unknown) => FacetValidationResult
}

export type FacetValidationResult =
  | { valid: true; errors: undefined }
  | { valid: false; errors: FacetValidationError[] }

export type FacetValidationError = {
  facet: string
  title: string
  pointer: string
  message: string
  keyword?: string
}

export type FacetContractErrorCode =
  | 'FACET_NOT_FOUND'
  | 'DIRECTION_MISMATCH'
  | 'TYPE_MISMATCH'
  | 'ENUM_CONFLICT'
  | 'MERGE_UNSUPPORTED'

export class FacetContractError extends Error {
  constructor(
    public readonly code: FacetContractErrorCode,
    message: string,
    public readonly detail?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'FacetContractError'
  }
}

export class FacetContractCompiler {
  private readonly catalog: FacetCatalog
  private readonly ajv: AjvInstance

  constructor(options?: FacetContractCompilerOptions) {
    this.catalog = options?.catalog ?? getFacetCatalog()
    if (options?.ajv) {
      this.ajv = options.ajv
    } else {
      const ajvOptions: AjvOptions = {
        allErrors: true,
        ...(options?.ajvOptions ?? {})
      }
      this.ajv = new Ajv(ajvOptions)
    }
  }

  compileContracts(input: CompileFacetContractsInput): CompiledFacetContracts {
    return {
      input: this.compileDirection('input', input.inputFacets ?? []),
      output: this.compileDirection('output', input.outputFacets ?? [])
    }
  }

  private compileDirection(direction: Extract<FacetDirection, 'input' | 'output'>, names: string[]): CompiledFacetSchema | undefined {
    if (names.length === 0) {
      return undefined
    }

    const definitions = this.resolveFacets(names, direction)
    const baseSchema: JsonSchemaShape = {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: true
    }

    const provenance: FacetProvenance[] = []

    for (const definition of definitions) {
      this.mergeFacetIntoSchema(baseSchema, definition, provenance, direction)
    }

    const validatorFn = this.ajv.compile(baseSchema) as ValidateFunction

    return {
      schema: baseSchema,
      provenance,
      validator: (payload: unknown) => {
        const valid = validatorFn(payload)
        if (valid) {
          return { valid: true, errors: undefined }
        }
        const errors =
          validatorFn.errors?.map((error: ErrorObject) => {
            const pointer = this.toJsonPointer(error)
            const facet = this.resolveFacetFromPointer(pointer, provenance)
            return {
              ...facet,
              pointer,
              message: error.message ?? 'Facet validation error',
              keyword: error.keyword
            }
          }) ?? []
        return { valid: false, errors }
      }
    }
  }

  private resolveFacets(names: string[], direction: Extract<FacetDirection, 'input' | 'output'>): FacetDefinition[] {
    try {
      return this.catalog.resolveMany(names, direction)
    } catch (error) {
      if (error instanceof FacetCatalogError) {
        throw new FacetContractError(error.code, error.message)
      }
      throw error
    }
  }

  private mergeFacetIntoSchema(
    target: JsonSchemaShape,
    definition: FacetDefinition,
    provenance: FacetProvenance[],
    direction: Extract<FacetDirection, 'input' | 'output'>
  ) {
    if (target.type !== 'object') {
      throw new FacetContractError('MERGE_UNSUPPORTED', 'Facet contracts must compile into object schemas.', {
        facet: definition.name
      })
    }

    const propertyKey = definition.metadata.propertyKey ?? definition.name
    const propertySchema = definition.schema
    const existingProperties = (target.properties ?? {}) as Record<string, JsonSchemaShape>
    const existingProperty = existingProperties[propertyKey]

    if (existingProperty) {
      this.ensureSchemasCompatible(existingProperty, propertySchema, definition, direction)
    }

    target.properties = {
      ...existingProperties,
      [propertyKey]: this.deepCloneSchema(propertySchema)
    }

    if (definition.metadata.requiredByDefault) {
      const requiredValues = Array.isArray(target.required) ? (target.required as string[]) : []
      const required = new Set<string>(requiredValues)
      required.add(propertyKey)
      target.required = Array.from(required)
    }

    provenance.push({
      facet: definition.name,
      title: definition.title,
      direction,
      pointer: `/${propertyKey}`
    })
  }

  private ensureSchemasCompatible(
    baseline: JsonSchemaShape,
    incoming: JsonSchemaShape,
    definition: FacetDefinition,
    direction: Extract<FacetDirection, 'input' | 'output'>
  ) {
    if (baseline.type && incoming.type && baseline.type !== incoming.type) {
      throw new FacetContractError('TYPE_MISMATCH', `Facet "${definition.name}" conflicts with an existing definition.`, {
        direction,
        existingType: baseline.type,
        incomingType: incoming.type
      })
    }

    const baselineEnumValues = Array.isArray((baseline as Record<string, unknown>).enum)
      ? ((baseline as Record<string, unknown>).enum as Array<string | number | boolean>)
      : []
    const incomingEnumValues = Array.isArray((incoming as Record<string, unknown>).enum)
      ? ((incoming as Record<string, unknown>).enum as Array<string | number | boolean>)
      : []

    if (baselineEnumValues.length && incomingEnumValues.length) {
      const baselineEnum = new Set<string | number | boolean>(baselineEnumValues)
      const overlap = incomingEnumValues.filter((value) => baselineEnum.has(value))
      if (overlap.length === 0) {
        throw new FacetContractError(
          'ENUM_CONFLICT',
          `Facet "${definition.name}" enum values conflict with prior schema.`,
          {
            direction,
            existing: baselineEnumValues,
            incoming: incomingEnumValues
          }
        )
      }
    }
  }

  private deepCloneSchema(schema: JsonSchemaShape): JsonSchemaShape {
    return JSON.parse(JSON.stringify(schema))
  }

  private resolveFacetFromPointer(pointer: string, provenance: FacetProvenance[]): { facet: string; title: string } {
    const match = /^\/([^/]+)/.exec(pointer ?? '')
    if (match) {
      const path = `/${match[1]}`
      const entry = provenance.find((item) => item.pointer === path) ?? provenance.find((item) => item.facet === match[1])
      if (entry) {
        return { facet: entry.facet, title: entry.title }
      }
      return { facet: match[1], title: match[1] }
    }
    return { facet: 'unknown', title: 'Unknown Facet' }
  }

  private toJsonPointer(error: ErrorObject): string {
    const instancePath = (error as ErrorObject & { instancePath?: string }).instancePath
    if (instancePath && instancePath.length > 0) {
      return instancePath
    }

    const dataPath = (error as ErrorObject & { dataPath?: string }).dataPath
    if (dataPath && dataPath.length > 0) {
      const normalised = dataPath
        .replace(/\[(\d+)\]/g, '/$1')
        .replace(/\['([^']+)'\]/g, '/$1')
        .replace(/\["([^\"]+)"\]/g, '/$1')
        .replace(/\./g, '/')
        .replace(/\/{2,}/g, '/')
      return normalised.startsWith('/') ? normalised : `/${normalised}`
    }

    return ''
  }
}
