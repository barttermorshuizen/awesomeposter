import { describe, it, expect } from 'vitest'
import type { TaskEnvelope } from '@awesomeposter/shared'
import { deriveAvailableEnvelopeFacets } from '../src/services/flex-planner'

describe('deriveAvailableEnvelopeFacets', () => {
  it('includes facets declared in the envelope inputs', () => {
    const envelope: TaskEnvelope = {
      objective: 'Employer branding - DX is een geweldig bedrijf om voor te werken',
      inputs: {
        company_information: { name: 'DX' },
        post_context: { type: 'new_employee' }
      },
      outputContract: {
        mode: 'facets',
        facets: ['creative_brief', 'strategic_rationale']
      }
    }

    const available = deriveAvailableEnvelopeFacets(envelope)

    expect(Array.from(available)).toEqual(
      expect.arrayContaining(['company_information', 'post_context', 'creative_brief', 'strategic_rationale'])
    )
  })

  it('defaults to an empty set when no inputs or facet outputs exist', () => {
    const envelope: TaskEnvelope = {
      objective: 'Test objective',
      outputContract: { mode: 'facets' }
    }

    const available = deriveAvailableEnvelopeFacets(envelope)

    expect(available.size).toBe(0)
  })
})
