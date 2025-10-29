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
    name: 'objectiveBrief',
    title: 'Objective Brief',
    description: 'Structured objective, constraints, and desired outcomes provided by the requestor.',
    schema: {
      type: 'object',
      properties: {
        objective: { type: 'string', minLength: 1 },
        successCriteria: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        },
        constraints: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        },
        notes: { type: 'string' }
      },
      required: ['objective'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Captures the core ask, guardrails, and measures of success for the work.',
      instruction:
        'Review the `objectiveBrief` and ensure the objective, constraints, and success criteria guide downstream planning.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['brief', 'objective'],
      requiredByDefault: true
    }
  },
  {
    name: 'audienceProfile',
    title: 'Audience Profile',
    description: 'Audience personas, segments, and regional considerations that influence messaging.',
    schema: {
      type: 'object',
      properties: {
        persona: { type: 'string', minLength: 1 },
        segments: {
          type: 'array',
          minItems: 1,
          items: { type: 'string', minLength: 1 }
        },
        regions: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        },
        painPoints: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        }
      },
      required: ['persona'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Provides context about the target audience to tailor positioning and tone.',
      instruction:
        'Incorporate persona, segment, and region insights from `audienceProfile` when crafting strategy or content.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['audience', 'brief'],
      requiredByDefault: true
    }
  },
  {
    name: 'toneOfVoice',
    title: 'Tone of Voice',
    description: 'Controls the emotional style, diction, and energy applied to generated copy.',
    schema: {
      type: 'string',
      enum: ['Professional & Formal', 'Clear & Straightforward', 'Warm & Friendly', 'Confident & Bold', 'Inspiring & Visionary', 'Trusted & Reassuring', 'Energetic & Dynamic']
    },
    semantics: {
      summary: 'Align language and phrasing with the requested tone of voice.',
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
    name: 'toneGuidelines',
    title: 'Tone Guidelines',
    description: 'Provides guidelines for the emotional style, diction, and energy applied to generated copy.',
    schema: { type: 'string', minLength:1 },
    semantics: {
      summary: 'Align language and phrasing with the requested tone guidelines.',
      instruction:
        'Review caller preferences and adjust diction, cadence, and emotional style to match the `toneGuidelines` value.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['style', 'tone'],
      requiredByDefault: true
    }
  },
  {
    name: 'assetBundle',
    title: 'Asset Bundle',
    description: 'Supporting assets (documents, links, media) referenced during planning.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', minLength: 1 },
          label: { type: 'string', minLength: 1 },
          uri: { type: 'string', minLength: 1 },
          payload: { type: 'object' },
          summary: { type: 'string', minLength: 1 }
        },
        required: ['type'],
        additionalProperties: true
      }
    },
    semantics: {
      summary: 'Grounds planning work with reference materials and prior outputs.',
      instruction:
        'Review each entry in the `assetBundle` before planning to extract insights or constraints relevant to the objective.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['assets', 'strategy'],
      requiredByDefault: false,
      propertyKey: 'assets'
    }
  },
  {
    name: 'writerBrief',
    title: 'Writer Brief',
    description: 'Narrative direction, key points, and constraints authored by strategy for downstream writers.',
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
        },
        knobs: {
          type: 'object',
          properties: {
            formatType: {
              type: 'string',
              enum: ['text', 'single_image', 'multi_image', 'document_pdf', 'video']
            },
            hookIntensity: {
              type: 'number',
              minimum: 0,
              maximum: 1
            },
            expertiseDepth: {
              type: 'number',
              minimum: 0,
              maximum: 1
            },
            structure: {
              type: 'object',
              properties: {
                lengthLevel: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1
                },
                scanDensity: {
                  type: 'number',
                  minimum: 0,
                  maximum: 1
                }
              },
              additionalProperties: false
            }
          },
          additionalProperties: false
        }
      },
      required: ['angle', 'keyPoints'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Outlines the narrative direction used by writers when producing drafts.',
      instruction:
        'Consume the `writerBrief` object and honour its `angle`, `keyPoints`, constraints, and knob guidance while crafting deliverables.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['brief', 'strategy'],
      requiredByDefault: true
    }
  },
  {
    name: 'planKnobs',
    title: 'Plan Knobs',
    description: 'Normalised levers for downstream execution (variant counts, CTA emphasis, structure).',
    schema: {
      type: 'object',
      properties: {
        variantCount: {
          type: 'integer',
          minimum: 1,
          maximum: 5
        },
        formatType: {
          type: 'string',
          enum: ['text', 'single_image', 'multi_image', 'document_pdf', 'video']
        },
        hookIntensity: {
          type: 'number',
          minimum: 0,
          maximum: 1
        },
        expertiseDepth: {
          type: 'number',
          minimum: 0,
          maximum: 1
        },
        ctaFocus: { type: 'string' },
        structure: {
          type: 'object',
          properties: {
            lengthLevel: {
              type: 'number',
              minimum: 0,
              maximum: 1
            },
            scanDensity: {
              type: 'number',
              minimum: 0,
              maximum: 1
            }
          },
          additionalProperties: false
        }
      },
      required: ['formatType'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Defines the adjustable levers the planner and execution engine coordinate on.',
      instruction:
        'Read `planKnobs` to understand the required variant count, format, and structural expectations; keep it in sync with writer outputs.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['controls', 'strategy'],
      requiredByDefault: true
    }
  },
  {
    name: 'strategicRationale',
    title: 'Strategic rationale',
    description: 'Strategic rationale describing why the recommended social media approach satisfies the client objective.',
    schema: { type: 'string', minLength: 1 },
    semantics: {
      summary: 'Explains the strategic reasoning behind the plan.',
      instruction:
        'Produce a `strategicRationale` that provides the communication approach to achieve the client objective.'
    },
    metadata: {
      version: 'v1',
      direction: 'output',
      tags: ['strategy', 'explanation'],
      requiredByDefault: true
    }
  },
  {
    name: 'copyVariants',
    title: 'Copy Variants',
    description: 'Structured multi-variant output payload for downstream channels and QA.',
    schema: {
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
    },
    semantics: {
      summary: 'Represents the draft variants produced by writing agents.',
      instruction:
        'Emit a JSON object with a `copyVariants` array containing each variant suitable for the target channel.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['execution', 'deliverable'],
      requiredByDefault: true
    }
  },
  {
    name: 'qaRubric',
    title: 'QA Rubric',
    description: 'Policy, compliance, and quality checks QA agents must enforce.',
    schema: {
      type: 'object',
      properties: {
        checks: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        },
        thresholds: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        autoFailReasons: {
          type: 'array',
          items: { type: 'string', minLength: 1 }
        }
      },
      additionalProperties: true
    },
    semantics: {
      summary: 'Defines the compliance gates and quality expectations for QA review.',
      instruction:
        'Apply each rule described in `qaRubric`, recording findings and thresholds for a given deliverable.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['qa', 'policy'],
      requiredByDefault: true
    }
  },
  {
    name: 'qaFindings',
    title: 'QA Findings',
    description: 'Structured QA results including scores, issues, and the overall decision.',
    schema: {
      type: 'object',
      properties: {
        overallStatus: {
          type: 'string',
          enum: ['pass', 'fail', 'warn']
        },
        scores: {
          type: 'object',
          additionalProperties: { type: 'number' }
        },
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              facet: { type: 'string', minLength: 1 },
              message: { type: 'string', minLength: 1 },
              severity: { type: 'string', minLength: 1 }
            },
            required: ['message'],
            additionalProperties: false
          }
        }
      },
      required: ['overallStatus'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Communicates QA results and policy compliance for downstream decision making.',
      instruction:
        'Populate `qaFindings` with the decision (`overallStatus`), supporting scores, and any issues detected during review.'
    },
    metadata: {
      version: 'v1',
      direction: 'output',
      tags: ['qa', 'policy'],
      requiredByDefault: true
    }
  },
  {
    name: 'recommendationSet',
    title: 'Recommendation Set',
    description: 'Normalised follow-up actions QA provides.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string', minLength: 1 },
          recommendation: { type: 'string', minLength: 1 },
          rationale: { type: 'string', minLength: 1 }
        },
        required: ['recommendation'],
        additionalProperties: false
      }
    },
    semantics: {
      summary: 'Summarises what should happen next after QA review.',
      instruction:
        'Return actionable follow-ups in `recommendationSet`, including severity and rationale when revisions are required.'
    },
    metadata: {
      version: 'v1',
      direction: 'output',
      tags: ['qa', 'followup'],
      requiredByDefault: true
    }
  },
  {
    name: 'clarificationRequest',
    title: 'Clarification Request',
    description: 'Questions and supporting context that require input from a human agent.',
    schema: {
      type: 'object',
      properties: {
        pendingQuestions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1 },
              question: { type: 'string', minLength: 1 },
              rationale: { type: 'string' },
              priority: { type: 'string', enum: ['high', 'normal', 'low'], default: 'normal' },
              required: { type: 'boolean', default: true },
              context: { type: 'object' }
            },
            required: ['id', 'question'],
            additionalProperties: true
          }
        },
        generatedBy: { type: 'string' },
        createdAt: { type: 'string', format: 'date-time' }
      },
      required: ['pendingQuestions'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Lists the unresolved clarifications the planner needs before progressing a flex run.',
      instruction:
        'Review each entry in `pendingQuestions`. Provide definitive answers or explicitly decline with rationale if the question cannot be satisfied.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['human', 'clarification'],
      requiredByDefault: true
    }
  },
  {
    name: 'clarificationResponse',
    title: 'Clarification Response',
    description: 'Structured answers from human strategists resolving pending clarification items.',
    schema: {
      type: 'object',
      properties: {
        responses: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              questionId: { type: 'string', minLength: 1 },
              status: {
                type: 'string',
                enum: ['answered', 'declined', 'needs_follow_up'],
                default: 'answered'
              },
              response: { type: 'string' },
              notes: { type: 'string' },
              attachments: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    label: { type: 'string', minLength: 1 },
                    uri: { type: 'string', minLength: 1 }
                  },
                  required: ['label', 'uri'],
                  additionalProperties: true
                }
              }
            },
            required: ['questionId', 'status'],
            additionalProperties: true
          }
        },
        readyForPlanner: { type: 'boolean', default: true },
        submittedAt: { type: 'string', format: 'date-time' },
        operatorId: { type: 'string' }
      },
      required: ['responses'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Captures the human-provided clarifications so the planner can resume deterministically.',
      instruction:
        'Populate `responses` with final answers. Mark items as `declined` only when the run must fail; include notes describing the blocker.'
    },
    metadata: {
      version: 'v1',
      direction: 'output',
      tags: ['human', 'clarification'],
      requiredByDefault: true
    }
  }
]

const marketingFacetDefinitions: FacetDefinition[] = [
  {
    name: 'post_context',
    title: 'Post Context',
    description:
      'Structured brief of the campaign objective, audience, channels, and supporting assets used to plan social posts.',
    schema: {
      type: 'object',
      properties: {
        campaign: { type: 'string', minLength: 1 },
        type: {
          type: 'string',
          description: 'Canonical post scenario.',
          enum: ['launch', 'announcement', 'event', 'case_study', 'hiring', 'thought_leadership']
        },
        summary: { type: 'string', minLength: 1 },
        audience: {
          type: 'object',
          properties: {
            persona: { type: 'string' },
            industry: { type: 'string' },
            regions: { type: 'array', items: { type: 'string' } }
          },
          additionalProperties: true
        },
        channels: { type: 'array', items: { type: 'string' } },
        assets: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', minLength: 1 },
              uri: { type: 'string', minLength: 1 },
              type: { type: 'string' }
            },
            required: ['label', 'uri'],
            additionalProperties: true
          }
        },
        dueDate: { type: 'string', format: 'date-time' },
        notes: { type: 'string' }
      },
      required: ['type', 'summary'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Supplies campaign inputs that every downstream capability references.',
      instruction:
        'Read the campaign type, summary, and audience fields to ground strategy decisions. Use attached assets for factual grounding.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'feedback',
    title: 'Feedback',
    description: 'Threaded feedback items tied to specific facets so replanning can target affected work.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          author: { type: 'string', minLength: 1 },
          facet: { type: 'string', minLength: 1 },
          message: { type: 'string', minLength: 1 },
          severity: { type: 'string', enum: ['info', 'minor', 'major', 'critical'] },
          timestamp: { type: 'string', format: 'date-time' },
          resolution: { type: 'string', enum: ['open', 'addressed', 'dismissed'] },
          path: { type: 'string' },
          note: { type: 'string' }
        },
        required: ['author', 'facet', 'message'],
        additionalProperties: true
      }
    },
    semantics: {
      summary: 'Provides a structured trail of reviewer comments mapped to facets.',
      instruction:
        'Append new entries when review feedback arrives or when work has addressed the item. Keep facet references accurate for replanning.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'creative_brief',
    title: 'Creative Brief',
    description: 'Executive summary of the strategy direction for writers and designers.',
    schema: {
      type: 'object',
      properties: {
        core_message: { type: 'string', minLength: 1 },
        supporting_points: { type: 'array', items: { type: 'string' } },
        tone: { type: 'string' },
        structure: { type: 'string' },
        audience: { type: 'string' },
        call_to_action: { type: 'string' },
        visual_guidelines: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['square', 'portrait', 'landscape', 'story'] },
            image_count: { type: 'integer', minimum: 1 },
            notes: { type: 'string' }
          },
          additionalProperties: true
        }
      },
      required: ['core_message', 'tone', 'audience'],
      additionalProperties: false
    },
    semantics: {
      summary: 'Guides downstream creatives with consistent direction.',
      instruction:
        'Produce or update the brief so writers and designers can execute without ambiguity. Capture structure, tone, and must-have talking points.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'strategic_rationale',
    title: 'Strategic Rationale',
    description: 'Plain-text reasoning for campaign choices.',
    schema: {
      type: 'string',
      minLength: 1
    },
    semantics: {
      summary: 'Explains the “why” for decisions in a human-readable paragraph.',
      instruction: 'Capture the reasoning behind the current plan so reviewers understand trade-offs and intent.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'handoff_summary',
    title: 'Handoff Summary',
    description: 'Rolling log of notable decisions and status updates between capabilities.',
    schema: {
      type: 'array',
      items: { type: 'string' }
    },
    semantics: {
      summary: 'Keeps every agent informed across the orchestration chain.',
      instruction: 'Append an entry summarising your contribution or outstanding risks when completing the capability.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'positioning_context',
    title: 'Positioning Context',
    description: 'Market and competitive intelligence used to evolve positioning.',
    schema: {
      type: 'object',
      properties: {
        company: { type: 'string', minLength: 1 },
        market: { type: 'string' },
        competitors: { type: 'array', items: { type: 'string' } },
        differentiators: { type: 'array', items: { type: 'string' } },
        challenges: { type: 'array', items: { type: 'string' } },
        research: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string' },
              summary: { type: 'string' },
              url: { type: 'string' }
            },
            additionalProperties: true
          }
        }
      },
      required: ['company'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Provides the raw material for positioning analysis.',
      instruction:
        'Use the context to benchmark positioning ideas. Update the facet when new research or stakeholder input arrives.'
    },
    metadata: {
      version: 'v1',
      direction: 'input',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'value_canvas',
    title: 'Value Canvas',
    description: 'Snapshot of customer segments, pains, and value propositions used in positioning.',
    schema: {
      type: 'object',
      properties: {
        segments: { type: 'array', items: { type: 'string' } },
        pains: { type: 'array', items: { type: 'string' } },
        gains: { type: 'array', items: { type: 'string' } },
        proof: { type: 'array', items: { type: 'string' } }
      },
      additionalProperties: false
    },
    semantics: {
      summary: 'Summarises the customer value map for quick reference.',
      instruction: 'Keep the canvas aligned with the latest research so messaging and campaigns stay on brief.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'positioning_opportunities',
    title: 'Positioning Opportunities',
    description: 'Quantified opportunities or risks discovered during positioning analysis.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          impact: { type: 'number' },
          confidence: { type: 'number' },
          notes: { type: 'string' }
        },
        required: ['name'],
        additionalProperties: false
      }
    },
    semantics: {
      summary: 'Highlights the biggest areas of leverage or concern for marketers.',
      instruction:
        'List opportunities with impact/confidence context so strategists and directors can prioritise follow-up.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'positioning_recommendation',
    title: 'Positioning Recommendation',
    description: 'End-to-end positioning statement with rationale.',
    schema: {
      type: 'object',
      properties: {
        statement: { type: 'string', minLength: 1 },
        differentiators: { type: 'array', items: { type: 'string' } },
        proof_points: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' }
      },
      required: ['statement'],
      additionalProperties: false
    },
    semantics: {
      summary: 'Communicates the recommended position to downstream teams.',
      instruction: 'Provide a concise statement supported by differentiators and rationale so messaging stays aligned.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'messaging_stack',
    title: 'Messaging Stack',
    description: 'Structured hierarchy of messaging pillars and supporting copy guidance.',
    schema: {
      type: 'object',
      properties: {
        core_message: { type: 'string', minLength: 1 },
        message_pillars: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              pillar: { type: 'string', minLength: 1 },
              proof_point: { type: 'string' },
              message: { type: 'string' }
            },
            required: ['pillar', 'message'],
            additionalProperties: false
          }
        },
        tone: { type: 'string' }
      },
      required: ['core_message', 'message_pillars'],
      additionalProperties: false
    },
    semantics: {
      summary: 'Bridges positioning outputs with campaign-ready copy guidance.',
      instruction:
        'Detail message pillars and proof points so writers can spin up content without reinterpreting strategy.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'positioning',
    title: 'Approved Positioning',
    description: 'Final approved positioning package combining narrative summary, quantitative factors, and aligned messaging stack.',
    schema: {
      type: 'object',
      properties: {
        positioning_summary: { type: 'string', minLength: 1 },
        factors: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', minLength: 1 },
              score: { type: 'number' },
              rationale: { type: 'string' }
            },
            required: ['name'],
            additionalProperties: false
          }
        },
        messaging_stack: {
          type: 'object',
          properties: {
            core_message: { type: 'string', minLength: 1 },
            message_pillars: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  pillar: { type: 'string', minLength: 1 },
                  proof_point: { type: 'string' },
                  message: { type: 'string' }
                },
                required: ['pillar', 'message'],
                additionalProperties: false
              }
            }
          },
          required: ['core_message', 'message_pillars'],
          additionalProperties: false
        }
      },
      required: ['positioning_summary', 'factors', 'messaging_stack'],
      additionalProperties: false
    },
    semantics: {
      summary: 'Captures the approved positioning output after director review for downstream distribution.',
      instruction:
        'Populate when the positioning package is approved. Ensure factors and messaging align with the final decision, and update positioning_summary with the public-facing articulation.'
    },
    metadata: {
      version: 'v1',
      direction: 'output',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'post_copy',
    title: 'Post Copy',
    description: 'Final or in-progress social copy text.',
    schema: {
      type: 'string',
      minLength: 1
    },
    semantics: {
      summary: 'Holds the latest social copy for review or publication.',
      instruction: 'Overwrite with the current approved draft. Maintain consistent formatting for downstream tools.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'post_visual',
    title: 'Post Visual',
    description: 'References to visual assets that accompany the social post.',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          uri: { type: 'string', minLength: 1 },
          label: { type: 'string' },
          format: { type: 'string' }
        },
        required: ['uri'],
        additionalProperties: true
      }
    },
    semantics: {
      summary: 'Tracks the canonical assets designers deliver and reviewers approve.',
      instruction: 'Update with the latest asset URLs. Include descriptive labels for directors and publishers.'
    },
    metadata: {
      version: 'v1',
      direction: 'bidirectional',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  },
  {
    name: 'post',
    title: 'Social Post',
    description: 'Final approved social post ready for distribution.',
    schema: {
      type: 'object',
      properties: {
        copy: { type: 'string', minLength: 1 },
        visuals: { type: 'array', items: { type: 'string', minLength: 1 } },
        scheduledFor: { type: 'string', format: 'date-time' },
        approvals: { type: 'array', items: { type: 'string' } }
      },
      required: ['copy'],
      additionalProperties: true
    },
    semantics: {
      summary: 'Represents the final deliverable after director approval.',
      instruction:
        'Publishers consume this facet. Ensure copy and visuals reflect the approved state before marking the capability complete.'
    },
    metadata: {
      version: 'v1',
      direction: 'output',
      tags: ['marketing-agency', 'sandbox'],
      requiredByDefault: true
    }
  }
]

defaultDefinitions.push(...marketingFacetDefinitions)

let defaultCatalog: FacetCatalog | null = null

export function getFacetCatalog(): FacetCatalog {
  if (!defaultCatalog) {
    defaultCatalog = new FacetCatalog(defaultDefinitions)
  }
  return defaultCatalog
}
