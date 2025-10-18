import type { OutputContract } from '@awesomeposter/shared'
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

function nowIso(): string {
  return new Date().toISOString()
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? null)) as T
}

export class RunContext {
  private readonly facets = new Map<string, FacetEntry>()

  static fromSnapshot(snapshot: FacetSnapshot | null | undefined): RunContext {
    const context = new RunContext()
    if (!snapshot) return context
    for (const [facet, entry] of Object.entries(snapshot)) {
      context.facets.set(facet, clone(entry))
    }
    return context
  }

  snapshot(): FacetSnapshot {
    const result: FacetSnapshot = {}
    for (const [facet, entry] of this.facets.entries()) {
      result[facet] = clone(entry)
    }
    return result
  }

  getFacet(name: string): FacetEntry | undefined {
    const existing = this.facets.get(name)
    return existing ? clone(existing) : undefined
  }

  getAllFacets(): FacetSnapshot {
    return this.snapshot()
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
