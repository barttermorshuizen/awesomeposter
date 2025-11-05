import { getDb, eq, capabilitySnippets } from '@awesomeposter/db'
import { sql } from 'drizzle-orm'

export type StrategistKnowledgeRow = {
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

const DEFAULT_CORPUS_ID = 'flex.social-strategist.v1'
const DEFAULT_LIMIT = 6

function toVectorLiteral(values: number[]): string {
  return `[${values.join(',')}]`
}

export class StrategistKnowledgeRepository {
  constructor(private readonly corpusId = DEFAULT_CORPUS_ID) {}

  async findSimilar(embedding: number[], limit = DEFAULT_LIMIT): Promise<StrategistKnowledgeRow[]> {
    if (!embedding.length) return []
    const db = getDb()
    const vectorLiteral = toVectorLiteral(embedding)
    const vectorSql = sql.raw(`'${vectorLiteral}'::vector`)
    const distanceSql = sql<number>`(${capabilitySnippets.embedding} <-> ${vectorSql})`
    const orderScore = sql`(${capabilitySnippets.embedding} <-> ${vectorSql}) - ${capabilitySnippets.scoreBoost}`

    const rows = await db
      .select({
        id: capabilitySnippets.id,
        title: capabilitySnippets.title,
        summary: capabilitySnippets.summary,
        body: capabilitySnippets.body,
        tags: capabilitySnippets.tags,
        source: capabilitySnippets.source,
        refreshedAt: capabilitySnippets.refreshedAt,
        scoreBoost: capabilitySnippets.scoreBoost,
        distance: distanceSql
      })
      .from(capabilitySnippets)
      .where(eq(capabilitySnippets.corpusId, this.corpusId))
      .orderBy(orderScore)
      .limit(limit)

    return rows.map((row) => ({
      ...row,
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === 'string') : [],
      scoreBoost: typeof row.scoreBoost === 'number' ? row.scoreBoost : Number(row.scoreBoost ?? 0),
      distance: typeof row.distance === 'number' ? row.distance : Number(row.distance ?? 0)
    }))
  }
}
