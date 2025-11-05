// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { StrategistRetrievalService } from '../src/services/strategist-retrieval-service'

type RepositoryRow = {
  id: string
  title: string
  summary: string
  body: string
  tags: string[]
  source: string
  refreshedAt: string
  scoreBoost: number
  distance: number
}

class RepositoryStub {
  constructor(private readonly rows: RepositoryRow[], private readonly shouldThrow = false) {}
  async findSimilar(): Promise<RepositoryRow[]> {
    if (this.shouldThrow) {
      throw new Error('repository unavailable')
    }
    return this.rows
  }
}

function createService(
  rows: RepositoryRow[],
  opts: { shouldThrow?: boolean } = {}
): StrategistRetrievalService {
  const repo = new RepositoryStub(rows, opts.shouldThrow)
  const embeddingsClient: any = {
    embeddings: {
      create: async () => ({
        data: [
          {
            embedding: Array(1536).fill(0)
          }
        ]
      })
    }
  }
  return new StrategistRetrievalService({
    repository: repo as any,
    embeddingsClient
  })
}

describe('StrategistRetrievalService', () => {
  it('retrieves strategist snippets for a query', async () => {
    const service = createService([
      {
        id: 'snippet-1',
        title: 'Welcome Post Blueprint',
        summary: 'Steps for onboarding announcements.',
        body: 'Focus on impact, team quotes, and future vision.',
        tags: ['welcome', 'linkedin'],
        source: 'test',
        refreshedAt: '2025-10-15T00:00:00.000Z',
        scoreBoost: 0.1,
        distance: 0.4
      }
    ])

    const bundle = await service.retrieveFromQuery('LinkedIn welcome post playbook')

    expect(bundle.status).toBe('ready')
    expect(bundle.snippets).toHaveLength(1)
    expect(bundle.snippets[0]).toMatchObject({
      id: 'snippet-1',
      title: 'Welcome Post Blueprint'
    })
  })

  it('falls back when repository lookups fail', async () => {
    const service = createService([], { shouldThrow: true })

    const bundle = await service.retrieveFromQuery('Campaign idea for job announcement')

    expect(bundle.status).toBe('fallback')
    expect(bundle.reason).toContain('unavailable')
    expect(bundle.snippets[0]?.fallback).toBe(true)
  })

  it('ignores non-strategist capabilities', async () => {
    const service = createService([
      {
        id: 'snippet-2',
        title: 'Irrelevant',
        summary: 'Should not surface',
        body: 'irrelevant',
        tags: [],
        source: 'test',
        refreshedAt: '2025-10-15T00:00:00.000Z',
        scoreBoost: 0,
        distance: 0.5
      }
    ])

    const bundle = await service.retrieveFromQuery('Any query', { capabilityId: 'copywriter.SocialpostDrafting' })

    expect(bundle.status).toBe('fallback')
    expect(bundle.reason).toContain('not configured')
  })
})
