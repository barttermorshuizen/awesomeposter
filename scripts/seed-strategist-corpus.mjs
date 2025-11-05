import { readFile } from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import OpenAI from 'openai'
import { getDb, capabilitySnippets, eq } from '@awesomeposter/db'

const CORPUS_ID = 'flex.social-strategist.v1'
const EMBEDDING_MODEL = 'text-embedding-3-small'
const MAX_CHARS_PER_CHUNK = 1800
const SUMMARY_WORDS = 45

function sanitizeTitle(raw) {
  if (!raw) return 'Strategist Guidance'
  const trimmed = raw.trim()
  return trimmed.length ? trimmed : 'Strategist Guidance'
}

function createSummary(text) {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  if (words.length <= SUMMARY_WORDS) return words.join(' ')
  return `${words.slice(0, SUMMARY_WORDS).join(' ')}…`
}

function computeChunkId(title, body) {
  return crypto.createHash('sha256').update(`${title}:${body}`).digest('hex').slice(0, 16)
}

function extractTags(title) {
  const tags = []
  const lower = title.toLowerCase()
  if (lower.includes('tone')) tags.push('tone')
  if (lower.includes('heuristic')) tags.push('heuristics')
  if (lower.includes('example') || lower.includes('exemplar')) tags.push('exemplar')
  return tags
}

function chunkMarkdown(source) {
  const lines = source.split(/\r?\n/)
  const chunks = []
  let currentTitle = 'Strategist Guidance'
  let currentBody = ''

  const flush = () => {
    if (!currentBody.trim()) return
    const title = sanitizeTitle(currentTitle)
    const body = currentBody.trim()
    chunks.push({
      title,
      body,
      chunkId: computeChunkId(title, body),
      summary: createSummary(body),
      tags: extractTags(title)
    })
    currentBody = ''
  }

  for (const line of lines) {
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      currentTitle = heading[1] ?? currentTitle
      continue
    }

    if ((currentBody + '\n' + line).length > MAX_CHARS_PER_CHUNK) {
      flush()
    }

    currentBody += `${line}\n`
  }

  flush()
  return chunks
}

async function main() {
  const [, , filePath] = process.argv
  if (!filePath) {
    console.error('Usage: node scripts/seed-strategist-corpus.mjs <markdown-file>')
    process.exit(1)
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.FLEX_OPENAI_API_KEY
  if (!apiKey) {
    console.error('OPENAI_API_KEY (or FLEX_OPENAI_API_KEY) must be set')
    process.exit(1)
  }

  const absolutePath = path.resolve(filePath)
  const markdown = await readFile(absolutePath, 'utf8')
  const chunks = chunkMarkdown(markdown)
  if (!chunks.length) {
    console.warn('No chunks generated from markdown; aborting.')
    return
  }

  console.log(`Generated ${chunks.length} chunk(s); embedding and upserting into Postgres…`)

  const client = new OpenAI({ apiKey })
  const db = getDb()
  const sourceLabel = path.basename(filePath)

  console.log(`Clearing existing entries for corpus "${CORPUS_ID}"…`)
  await db.delete(capabilitySnippets).where(eq(capabilitySnippets.corpusId, CORPUS_ID))
  console.log('Existing rows removed.')

  for (const chunk of chunks) {
    const embeddingResponse = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunk.body
    })
    const embedding = embeddingResponse.data[0]?.embedding
    if (!embedding || !Array.isArray(embedding)) {
      throw new Error(`Embedding model returned no data for chunk ${chunk.chunkId}`)
    }

    await db
      .insert(capabilitySnippets)
      .values({
        corpusId: CORPUS_ID,
        chunkId: chunk.chunkId,
        title: chunk.title,
        summary: chunk.summary,
        body: chunk.body,
        tags: chunk.tags,
        source: sourceLabel,
        embedding,
        embeddingModel: EMBEDDING_MODEL,
        scoreBoost: 0,
        metadataJson: {
          source: sourceLabel,
          tags: chunk.tags
        },
        refreshedAt: new Date()
      })
      .onConflictDoUpdate({
        target: [capabilitySnippets.corpusId, capabilitySnippets.chunkId],
        set: {
          title: chunk.title,
          summary: chunk.summary,
          body: chunk.body,
          tags: chunk.tags,
          source: sourceLabel,
          embedding,
          embeddingModel: EMBEDDING_MODEL,
          scoreBoost: 0,
          metadataJson: {
            source: sourceLabel,
            tags: chunk.tags
          },
          refreshedAt: new Date(),
          updatedAt: new Date()
        }
      })

    console.log(`Upserted chunk ${chunk.chunkId} (${chunk.title})`)
  }

  console.log('Done.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
