// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { STRATEGIST_SOCIAL_POSTING_CAPABILITY } from '../../src/agents/marketing/strategist-social-posting'
import { STRATEGIST_POSITIONING_CAPABILITY } from '../../src/agents/marketing/strategist-positioning'
import { COPYWRITER_SOCIAL_DRAFTING_CAPABILITY } from '../../src/agents/marketing/copywriter-socialpost-drafting'
import { COPYWRITER_MESSAGING_CAPABILITY } from '../../src/agents/marketing/copywriter-messaging'
import { DESIGNER_VISUAL_DESIGN_CAPABILITY } from '../../src/agents/marketing/designer-visual-design'
import { DIRECTOR_SOCIAL_REVIEW_CAPABILITY } from '../../src/agents/marketing/director-social-review'
import { DIRECTOR_POSITIONING_REVIEW_CAPABILITY } from '../../src/agents/marketing/director-positioning-review'
import { HUMAN_CLARIFY_CAPABILITY } from '../../src/agents/human-clarify-brief'
import type { CapabilityContract } from '@awesomeposter/shared'

type FacetCoverage = {
  input: string[]
  output: string[]
}

function getFacetList(contract?: CapabilityContract | null): string[] {
  if (!contract) return []
  if (contract.mode !== 'facets') {
    throw new Error('Capability exports must declare facet contracts during registration.')
  }
  return [...contract.facets].sort()
}

function loadCodeCoverage() {
  const capabilities = [
    STRATEGIST_SOCIAL_POSTING_CAPABILITY,
    STRATEGIST_POSITIONING_CAPABILITY,
    COPYWRITER_SOCIAL_DRAFTING_CAPABILITY,
    COPYWRITER_MESSAGING_CAPABILITY,
    DESIGNER_VISUAL_DESIGN_CAPABILITY,
    DIRECTOR_SOCIAL_REVIEW_CAPABILITY,
    DIRECTOR_POSITIONING_REVIEW_CAPABILITY,
    HUMAN_CLARIFY_CAPABILITY
  ]
  return new Map<string, FacetCoverage>(
    capabilities.map((capability) => [
      capability.capabilityId,
      {
        input: getFacetList(capability.inputContract),
        output: getFacetList(capability.outputContract)
      }
    ])
  )
}

function extractFacetNames(cell: string): string[] {
  const matches = Array.from(cell.matchAll(/`([^`]+)`/g))
  if (matches.length > 0) {
    return matches.map((match) => match[1].trim()).sort()
  }
  return cell
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0)
    .sort()
}

function loadDocumentCoverage(): Map<string, FacetCoverage> {
  const docPath = join(process.cwd(), 'docs/architecture/flex-agents-server.md')
  const doc = readFileSync(docPath, 'utf8')
  const tableStart = doc.indexOf('| Capability ID |')
  if (tableStart === -1) {
    throw new Error('Unable to locate capability inventory table in flex-agents-server.md')
  }

  const lines = doc.slice(tableStart).split('\n')
  const tableLines: string[] = []
  for (const line of lines) {
    if (!line.trim().startsWith('|')) break
    if (/^\|\s*---/.test(line)) continue
    if (line.includes('Capability ID')) continue
    tableLines.push(line)
  }

  return new Map(
    tableLines.map((line) => {
      const cells = line
        .split('|')
        .map((cell) => cell.trim())
        .slice(1, -1)
      const capabilityId = cells[0].replace(/`/g, '').trim()
      const inputFacets = extractFacetNames(cells[3])
      const outputFacets = extractFacetNames(cells[4])
      return [
        capabilityId,
        {
          input: inputFacets,
          output: outputFacets
        }
      ] as const
    })
  )
}

describe('Architecture documentation facet inventory', () => {
  it('lists input/output facets that match capability exports', () => {
    const codeCoverage = loadCodeCoverage()
    const docCoverage = loadDocumentCoverage()

    expect(new Set(docCoverage.keys())).toEqual(new Set(codeCoverage.keys()))

    for (const [capabilityId, codeFacets] of codeCoverage.entries()) {
      const docFacets = docCoverage.get(capabilityId)
      expect(docFacets, `Missing capability "${capabilityId}" in documentation table`).toBeDefined()
      expect(docFacets?.input).toEqual(codeFacets.input)
      expect(docFacets?.output).toEqual(codeFacets.output)
    }
  })
})
