import { FacetDefinitionSchema, type FacetDefinition, type FacetDirection } from './types.js'

export type FacetFilter = {
  direction?: Extract<FacetDirection, 'input' | 'output'>
  tag?: string
}

export class FacetCatalog {
  private readonly definitions: Map<string, FacetDefinition>

  constructor(definitions: FacetDefinition[]) {
    const parsed = definitions.map((definition) => FacetDefinitionSchema.parse(definition))
    this.definitions = new Map(
      parsed.map((definition) => [definition.name, Object.freeze({ ...definition })] as const)
    )

    if (this.definitions.size !== parsed.length) {
      throw new Error('Duplicate facet definitions detected. Ensure facet names are unique.')
    }
  }

  list(filter?: FacetFilter): FacetDefinition[] {
    const entries = Array.from(this.definitions.values())
    if (!filter) {
      return entries
    }

    return entries.filter((definition) => {
      const directionMatches = !filter.direction || this.isDirectionCompatible(definition.metadata.direction, filter.direction)
      const tagMatches = !filter.tag || definition.metadata.tags?.includes(filter.tag)
      return directionMatches && tagMatches
    })
  }

  get(name: string): FacetDefinition {
    const definition = this.definitions.get(name)
    if (!definition) {
      throw new FacetCatalogError('FACET_NOT_FOUND', `Facet "${name}" is not registered.`)
    }
    return definition
  }

  tryGet(name: string): FacetDefinition | undefined {
    return this.definitions.get(name)
  }

  resolveMany(names: string[], direction?: Extract<FacetDirection, 'input' | 'output'>): FacetDefinition[] {
    return names.map((name) => {
      const definition = this.get(name)
      if (direction && !this.isDirectionCompatible(definition.metadata.direction, direction)) {
        throw new FacetCatalogError(
          'DIRECTION_MISMATCH',
          `Facet "${name}" cannot be used for ${direction} contracts (declared direction: ${definition.metadata.direction}).`
        )
      }
      return definition
    })
  }

  private isDirectionCompatible(declared: FacetDirection, direction: Extract<FacetDirection, 'input' | 'output'>): boolean {
    return declared === 'bidirectional' || declared === direction
  }
}

export type FacetCatalogErrorCode = 'FACET_NOT_FOUND' | 'DIRECTION_MISMATCH'

export class FacetCatalogError extends Error {
  constructor(
    public readonly code: FacetCatalogErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'FacetCatalogError'
  }
}

const defaultDefinitions: FacetDefinition[] = [
  {
    name: 'toneOfVoice',
    title: 'Tone of Voice',
    description: 'Controls the emotional style, diction, and energy applied to generated copy.',
    schema: {
      type: 'string',
      enum: ['friendly', 'professional', 'inspiring', 'playful', 'bold']
    },
    semantics: {
      summary: 'Agents align their language and phrasing with the requested tone.',
      instruction:
        'Review caller preferences and adjust diction, cadence, and emotional style to match the `toneOfVoice` value.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['style', 'tone'],
      requiredByDefault: true
    }
  },
  {
    name: 'writerBrief',
    title: 'Writer Brief',
    description: 'Narrative direction, hooks, and constraints authored by strategy for downstream writers.',
    schema: {
      type: 'object',
      properties: {
        angle: { type: 'string', minLength: 1 },
        keyPoints: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 }
        },
        constraints: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        },
        mustInclude: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        }
      },
      required: ['angle', 'keyPoints'],
      additionalProperties: false
    },
    semantics: {
      summary: 'Outlines the narrative direction used by writers when producing drafts.',
      instruction:
        'Consume the `writerBrief` object and honour its `angle`, `keyPoints`, and `constraints` while crafting deliverables.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['brief', 'strategy'],
      requiredByDefault: true
    }
  },
  {
    name: 'copyVariants',
    title: 'Copy Variants',
    description: 'Structured multi-variant output payload for downstream channels and QA.',
    schema: {
      type: 'object',
      properties: {
        variants: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1 },
              headline: { type: 'string', minLength: 1 },
              body: { type: 'string', minLength: 1 },
              callToAction: { type: 'string', minLength: 1 }
            },
            required: ['headline', 'body'],
            additionalProperties: false
          }
        }
      },
      required: ['variants'],
      additionalProperties: false
    },
    semantics: {
      summary: 'Represents the draft variants produced by writing agents.',
      instruction:
        'Emit the `copyVariants` collection with each variant capturing a headline, body, and CTA suitable for the target channel.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['execution', 'deliverable'],
      requiredByDefault: true
    }
  }
]

let defaultCatalog: FacetCatalog | null = null

export function getFacetCatalog(): FacetCatalog {
  if (!defaultCatalog) {
    defaultCatalog = new FacetCatalog(defaultDefinitions)
  }
  return defaultCatalog
}
