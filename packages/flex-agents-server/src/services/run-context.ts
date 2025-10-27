import type { OutputContract, HitlClarificationEntry } from '@awesomeposter/shared'
import type { FlexPlan, FlexPlanNode } from './flex-planner'

export type FacetProvenanceRecord = {
  nodeId: string
  capabilityId?: string | null
  rationale?: string | string[]
  timestamp: string
}

export type FacetEntry = {
  value: unknown
  updatedAt: string
  provenance: FacetProvenanceRecord[]
}

export type FacetSnapshot = Record<string, FacetEntry>

export type RunContextSnapshot = {
  facets: FacetSnapshot
  hitlClarifications: HitlClarificationEntry[]
}

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T
}

export class RunContext {
  private readonly facets = new Map<string, FacetEntry>()
  private clarifications: HitlClarificationEntry[] = []

  static fromSnapshot(snapshot: RunContextSnapshot | FacetSnapshot | null | undefined): RunContext {
    const context = new RunContext()
    if (!snapshot) return context
    const resolvedSnapshot: RunContextSnapshot =
      snapshot && typeof (snapshot as any).facets === 'object'
        ? (snapshot as RunContextSnapshot)
        : { facets: (snapshot as FacetSnapshot) ?? {}, hitlClarifications: [] }

    for (const [facet, entry] of Object.entries(resolvedSnapshot.facets)) {
      context.facets.set(facet, clone(entry))
    }
    context.clarifications = resolvedSnapshot.hitlClarifications.map((entry) => clone(entry))
    return context
  }

  snapshot(): RunContextSnapshot {
    const facets: FacetSnapshot = {}
    for (const [facet, entry] of this.facets.entries()) {
      facets[facet] = clone(entry)
    }
    return {
      facets,
      hitlClarifications: this.clarifications.map((entry) => clone(entry))
    }
  }

  getFacet(name: string): FacetEntry | undefined {
    const existing = this.facets.get(name)
    return existing ? clone(existing) : undefined
  }

  getAllFacets(): FacetSnapshot {
    const snapshot = this.snapshot()
    return snapshot.facets
  }

  getHitlClarifications(): HitlClarificationEntry[] {
    return this.clarifications.map((entry) => clone(entry))
  }

  updateFacet(
    facet: string,
    value: unknown,
    provenance: Omit<FacetProvenanceRecord, 'timestamp'> & { timestamp?: string }
  ) {
    const timestamp = provenance.timestamp ?? nowIso()
    const entry: FacetEntry = {
      value: clone(value),
      updatedAt: timestamp,
      provenance: [
        ...(this.facets.get(facet)?.provenance ?? []),
        {
          nodeId: provenance.nodeId,
          capabilityId: provenance.capabilityId,
          rationale: provenance.rationale,
          timestamp
        }
      ]
    }
    this.facets.set(facet, entry)
  }

  updateFromNode(node: FlexPlanNode, output: Record<string, unknown> | null | undefined) {
    if (!output || !node.facets?.output?.length) return
    const timestamp = nowIso()

    const facets = node.facets.output

    const resolved: Array<{ facet: string; value: unknown }> = []
    for (const facet of facets) {
      if (Object.prototype.hasOwnProperty.call(output, facet)) {
        resolved.push({ facet, value: (output as Record<string, unknown>)[facet] })
      }
    }

    if (!resolved.length && facets.length === 1) {
      // If planner declared a single output facet but the capability returns a structured payload,
      // store the entire output object under that facet.
      resolved.push({ facet: facets[0], value: output })
    }

    resolved.forEach(({ facet, value }) => {
      this.updateFacet(facet, value, {
        nodeId: node.id,
        capabilityId: node.capabilityId,
        rationale: node.rationale,
        timestamp
      })
    })
  }

  recordClarificationQuestion(entry: {
    nodeId: string
    capabilityId?: string
    questionId: string
    question: string
    createdAt?: string
  }) {
    const createdAt = entry.createdAt ?? nowIso()
    const normalized: HitlClarificationEntry = {
      nodeId: entry.nodeId,
      capabilityId: entry.capabilityId,
      questionId: entry.questionId,
      question: entry.question,
      createdAt,
      answer: undefined,
      answeredAt: undefined
    }
    this.clarifications = this.clarifications
      .filter((clar) => clar.questionId !== entry.questionId)
      .concat([normalized])
  }

  recordClarificationAnswer(entry: {
    questionId: string
    answer: string
    answeredAt?: string
  }) {
    const answeredAt = entry.answeredAt ?? nowIso()
    this.clarifications = this.clarifications.map((clar) =>
      clar.questionId === entry.questionId
        ? {
            ...clar,
            answer: entry.answer,
            answeredAt
          }
        : clar
    )
  }

  composeFinalOutput(contract: OutputContract, plan?: FlexPlan): Record<string, unknown> {
    switch (contract.mode) {
      case 'facets': {
        const output: Record<string, unknown> = {}
        for (const facet of contract.facets) {
          const entry = this.facets.get(facet)
          if (entry) {
            output[facet] = clone(entry.value)
          }
        }
        return output
      }
      case 'json_schema': {
        const schemaKeys: string[] =
          contract.schema && typeof contract.schema === 'object'
            ? Object.keys((contract.schema as any).properties ?? {})
            : []
        const output: Record<string, unknown> = {}
        const candidateKeys = schemaKeys.length ? schemaKeys : Array.from(this.facets.keys())
        for (const key of candidateKeys) {
          const entry = this.facets.get(key)
          if (entry) {
            output[key] = clone(entry.value)
          }
        }
        if (Object.keys(output).length) return output
        // Fallback: attempt to use the last execution node output if available in plan context.
        if (plan) {
          for (let i = plan.nodes.length - 1; i >= 0; i -= 1) {
            const node = plan.nodes[i]
            if (node.facets?.output?.length) {
              const facet = node.facets.output[0]
              const entry = this.facets.get(facet)
              if (entry) {
                return { [facet]: clone(entry.value) }
              }
            }
          }
        }
        return {}
      }
      default:
        return {}
    }
  }
}
