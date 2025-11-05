import { OpenAI } from 'openai'
import type { TaskEnvelope, ContextKnowledgeBundle, ContextKnowledgeSnippet } from '@awesomeposter/shared'
import { getLogger } from './logger'
import { StrategistKnowledgeRepository } from './strategist-knowledge-repository'

export const STRATEGIST_CORPUS_ID = 'flex.social-strategist.v1'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const EMBEDDING_DIMENSIONS = 1536
const MAX_SNIPPETS = 3
const STRATEGIST_CAPABILITY_ID = 'strategist.SocialPosting' as const

export type StrategistRetrievalDependencies = {
  repository?: StrategistKnowledgeRepository
  embeddingsClient?: OpenAI
  now?: () => Date
}

const FALLBACK_SNIPPET: ContextKnowledgeSnippet = {
  id: 'strategist-retrieval-fallback',
  title: 'Strategist Retrieval Fallback Playbook',
  summary: 'Guidance applied whenever the curated corpus is unavailable or returned no matches.',
  body: [
    'When knowledge retrieval is unavailable:',
    '- Restate the objective and articulate at least two assumptions that require validation.',
    '- Default to the company tone guidance when present; otherwise use a confident-but-warm voice.',
    '- Flag missing assets or approvals in `handoff_summary.gaps` so downstream roles can address them.',
    'Document the retrieval gap in `handoff_summary.fallback` and include any error details from orchestration.'
  ].join('\n'),
  tags: ['fallback'],
  source: 'operations.runbook',
  lastUpdated: '2025-10-15T00:00:00.000Z',
  fallback: true,
  metadata: {
    escalation: 'Notify marketing-ops to refresh strategist corpus sync.'
  }
}

export class StrategistRetrievalService {
  private readonly repository: StrategistKnowledgeRepository
  private readonly embeddingsClient?: OpenAI
  private readonly now: () => Date

  constructor(deps: StrategistRetrievalDependencies = {}) {
    this.repository = deps.repository ?? new StrategistKnowledgeRepository(STRATEGIST_CORPUS_ID)
    this.embeddingsClient = deps.embeddingsClient
    this.now = deps.now ?? (() => new Date())
  }

  async buildKnowledgeBundle(
    envelope: TaskEnvelope,
    capabilityId?: string | null
  ): Promise<ContextKnowledgeBundle | undefined> {
    if (capabilityId !== STRATEGIST_CAPABILITY_ID) return undefined

    const query = this.composeQuery(envelope)
    if (!query) {
      return this.createFallback('No contextual inputs found to build retrieval prompt.')
    }

    return this.retrieveFromQuery(query, { capabilityId, limit: MAX_SNIPPETS })
  }

  async retrieveFromQuery(
    query: string,
    options: { capabilityId?: string | null; limit?: number } = {}
  ): Promise<ContextKnowledgeBundle> {
    const capabilityId = options.capabilityId ?? STRATEGIST_CAPABILITY_ID
    const limit = Math.min(Math.max(options.limit ?? MAX_SNIPPETS, 1), 10)
    if (capabilityId !== STRATEGIST_CAPABILITY_ID) {
      return this.createFallback(`Knowledge retrieval not configured for capability ${capabilityId ?? 'unknown'}.`)
    }
    const trimmedQuery = query?.trim()
    if (!trimmedQuery) {
      return this.createFallback('Knowledge retrieval requires a non-empty query.')
    }

    const embedding = await this.computeEmbedding(trimmedQuery)
    if (!embedding) {
      return this.createUnavailable('Embedding model unavailable; ensure OpenAI credentials are configured.')
    }

    if (embedding.length !== EMBEDDING_DIMENSIONS) {
      try {
        getLogger().warn('strategist_retrieval_unexpected_dimensions', {
          expected: EMBEDDING_DIMENSIONS,
          actual: embedding.length
        })
      } catch {}
    }

    let rows
    try {
      rows = await this.repository.findSimilar(embedding, limit)
      if (rows.length) {
        try {
          getLogger().info('strategist_retrieval_ready', {
            snippetCount: rows.length,
            topSnippet: rows[0]?.id,
            topDistance: rows[0]?.distance
          })
        } catch {}
      }
    } catch (error) {
      try {
        getLogger().warn('strategist_retrieval_repository_error', {
          error: error instanceof Error ? error.message : String(error)
        })
      } catch {}
      return this.createFallback('Knowledge repository unavailable; using fallback guidance.')
    }

    if (!rows.length) {
      return this.createFallback('No knowledge snippets matched the strategist query.')
    }

    const snippets: ContextKnowledgeSnippet[] = rows.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      body: row.body,
      tags: row.tags,
      source: row.source,
      lastUpdated: row.refreshedAt,
      score: Math.max(0, 1 - row.distance) + row.scoreBoost,
      metadata: {
        distance: row.distance,
        scoreBoost: row.scoreBoost
      }
    }))

    return {
      corpusId: STRATEGIST_CORPUS_ID,
      version: `${STRATEGIST_CORPUS_ID}.pgvector`,
      refreshCadence: {
        frequency: 'monthly',
        lastRefreshedAt: rows[0]?.refreshedAt ?? this.now().toISOString()
      },
      status: 'ready',
      snippets
    }
  }

  private composeQuery(envelope: TaskEnvelope): string {
    const inputs = (envelope.inputs ?? {}) as Record<string, unknown>
    const builder: string[] = [`Objective: ${envelope.objective}`]

    const company = inputs.company_information as Record<string, unknown> | undefined
    if (company) {
      const name = typeof company.name === 'string' ? company.name : null
      const tone = typeof company.tone_of_voice === 'string' ? company.tone_of_voice : null
      const audience = typeof company.audience_segments === 'string' ? company.audience_segments : null
      if (name) builder.push(`Company: ${name}`)
      if (tone) builder.push(`Tone: ${tone}`)
      if (audience) builder.push(`Audience: ${audience}`)
    }

    const postContext = inputs.post_context as Record<string, unknown> | undefined
    if (postContext) {
      const type = typeof postContext.type === 'string' ? postContext.type : null
      const data = postContext.data as Record<string, unknown> | undefined
      if (type) builder.push(`Post Type: ${type}`)
      if (data) {
        const description = typeof data.content_description === 'string' ? data.content_description : null
        const employee = typeof data.employee_name === 'string' ? data.employee_name : null
        const customer = typeof data.customer_name === 'string' ? data.customer_name : null
        if (description) builder.push(`Description: ${description}`)
        if (employee) builder.push(`Employee: ${employee}`)
        if (customer) builder.push(`Customer: ${customer}`)
      }
    }

    const additional = (inputs.additional_context ?? inputs.context_summary) as string | undefined
    if (typeof additional === 'string' && additional.trim().length) {
      builder.push(`Additional Context: ${additional.trim()}`)
    }

    const query = builder.filter(Boolean).join('\n')
    return query.trim().length ? query : ''
  }

  private async computeEmbedding(query: string): Promise<number[] | null> {
    try {
      const apiKey = this.resolveApiKey()
      if (!apiKey && !this.embeddingsClient) {
        return null
      }
      const client = this.embeddingsClient ?? new OpenAI({ apiKey })
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: query
      })
      const embedding = response.data[0]?.embedding
      return Array.isArray(embedding) ? embedding : null
    } catch (error) {
      getLogger().warn('strategist_retrieval_embedding_error', {
        error: error instanceof Error ? error.message : String(error)
      })
      return null
    }
  }

  private resolveApiKey(): string | undefined {
    return process.env.FLEX_OPENAI_API_KEY || process.env.OPENAI_API_KEY
  }

  private createFallback(reason: string): ContextKnowledgeBundle {
    return {
      corpusId: STRATEGIST_CORPUS_ID,
      version: `${STRATEGIST_CORPUS_ID}.pgvector`,
      refreshCadence: {
        frequency: 'monthly',
        lastRefreshedAt: this.now().toISOString()
      },
      status: 'fallback',
      reason,
      snippets: [FALLBACK_SNIPPET]
    }
  }

  private createUnavailable(reason: string): ContextKnowledgeBundle {
    return {
      corpusId: STRATEGIST_CORPUS_ID,
      version: `${STRATEGIST_CORPUS_ID}.pgvector`,
      refreshCadence: {
        frequency: 'monthly',
        lastRefreshedAt: this.now().toISOString()
      },
      status: 'unavailable',
      reason,
      snippets: [FALLBACK_SNIPPET]
    }
  }
}
