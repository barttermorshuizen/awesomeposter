#!/usr/bin/env node

import { performance } from 'node:perf_hooks'
import { randomUUID, createHash } from 'node:crypto'
import { setTimeout as sleep } from 'node:timers/promises'
import { Pool } from 'pg'

const DEFAULT_RPS = 50
const DEFAULT_DURATION = 30
const DEFAULT_ITEMS = 1000
const LATENCY_DEGRADE_MS = 400

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    const [key, value] = arg.includes('=') ? arg.slice(2).split('=') : [arg.slice(2), argv[++i]]
    if (key === 'seed') {
      args.seed = true
      continue
    }
    args[key] = value ?? true
  }
  return args
}

function requireArg(args, name) {
  const value = args[name]
  if (!value) {
    console.error(`Missing required argument --${name}`)
    process.exit(1)
  }
  return value
}

async function seedData(pool, { clientId, items }) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const sourceIds = []
    for (let i = 0; i < 4; i += 1) {
      const sourceId = randomUUID()
      sourceIds.push(sourceId)
      await client.query(
        `INSERT INTO discovery_sources (id, client_id, url, canonical_url, source_type, identifier, notes, config_json, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())
         ON CONFLICT (id) DO NOTHING`,
        [
          sourceId,
          clientId,
          `https://example.com/source-${i}`,
          `https://example.com/source-${i}`,
          'rss',
          `source-${i}`,
          null,
          JSON.stringify({}),
        ],
      )
    }

    const itemPromises = []
    for (let i = 0; i < items; i += 1) {
      const itemId = randomUUID()
      const sourceId = sourceIds[i % sourceIds.length]
      const title = `Discovery item ${i + 1}`
      const body = `Sample body content for item ${i + 1} about AI marketing strategies.`
      const rawHash = createHash('sha256').update(`${sourceId}:${title}:${i}`).digest('hex')
      const fetchedAt = new Date(Date.now() - i * 60000)
      const publishedAt = new Date(fetchedAt.getTime() - 600000)
      itemPromises.push(
        client.query(
          `INSERT INTO discovery_items (
            id, client_id, source_id, external_id, raw_hash, status, title, url,
            fetched_at, published_at, published_at_source, ingested_at,
            raw_payload_json, normalized_json, source_metadata_json
          )
          VALUES (
            $1,$2,$3,$4,$5,'scored',$6,$7,$8,$9,'original',$10,$11,$12,$13
          )
          ON CONFLICT (client_id, raw_hash) DO NOTHING`,
          [
            itemId,
            clientId,
            sourceId,
            `ext-${i}`,
            rawHash,
            title,
            `https://example.com/articles/${i}`,
            fetchedAt.toISOString(),
            publishedAt.toISOString(),
            new Date().toISOString(),
            JSON.stringify({ body }),
            JSON.stringify({
              excerpt: body.slice(0, 200),
              extractedBody: body,
              fetchedAt: fetchedAt.toISOString(),
              publishedAt: publishedAt.toISOString(),
              contentType: 'article',
            }),
            JSON.stringify({ contentType: 'rss' }),
          ],
        ).then(() =>
          client.query(
            `INSERT INTO discovery_scores (
              item_id, score, keyword_score, recency_score, source_score,
              applied_threshold, weights_version, components_json,
              rationale_json, knobs_hint_json, metadata_json, status_outcome, scored_at
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,1,$7,NULL,NULL,$8,'scored',NOW()
            )
            ON CONFLICT (item_id) DO NOTHING`,
            [
              itemId,
              Math.random().toFixed(2),
              Math.random().toFixed(2),
              Math.random().toFixed(2),
              Math.random().toFixed(2),
              '0.60',
              JSON.stringify({ keyword: 0.6, recency: 0.2, source: 0.2 }),
              JSON.stringify({ topics: ['ai', 'marketing'] }),
            ],
          ),
        ),
      )
    }
    await Promise.all(itemPromises)
    await client.query('COMMIT')
    console.log(`Seeded ${items} discovery items for client ${clientId}`)
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

function percentile(values, p) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[index]
}

async function runBenchmark({ url, clientId, rps, duration, headers }) {
  const latencies = []
  let degradedCount = 0
  let errorCount = 0
  const totalRequests = rps * duration

  console.log(`Running benchmark against ${url} (${rps} RPS for ${duration}s, ${totalRequests} requests)`)

  for (let second = 0; second < duration; second += 1) {
    const batch = []
    for (let i = 0; i < rps; i += 1) {
      const requestUrl = new URL(url)
      requestUrl.searchParams.set('clientId', clientId)
      if (!requestUrl.searchParams.has('status')) {
        requestUrl.searchParams.set('status', 'spotted')
      }
      if (!requestUrl.searchParams.has('pageSize')) {
        requestUrl.searchParams.set('pageSize', '50')
      }
      batch.push(
        (async () => {
          const started = performance.now()
          const response = await fetch(requestUrl, { headers })
          const latency = performance.now() - started
          latencies.push(latency)
          if (!response.ok) {
            errorCount += 1
            return
          }
          const payload = await response.json().catch(() => null)
          if (payload && typeof payload.latencyMs === 'number' && payload.latencyMs > LATENCY_DEGRADE_MS) {
            degradedCount += 1
          }
        })(),
      )
    }
    await Promise.all(batch)
    // small pause to keep cadence close to 1s between batches
    await sleep(1000)
  }

  const p50 = percentile(latencies, 50).toFixed(2)
  const p95 = percentile(latencies, 95).toFixed(2)
  const max = Math.max(...latencies).toFixed(2)

  console.log('\nBenchmark Summary')
  console.table({
    'P50 latency (ms)': p50,
    'P95 latency (ms)': p95,
    'Max latency (ms)': max,
    'Requests sent': totalRequests,
    'Errors': errorCount,
    'Local degrade detections': degradedCount,
  })
}

async function main() {
  const args = parseArgs(process.argv)
  const clientId = requireArg(args, 'client')
  const items = Number.parseInt(args.items ?? DEFAULT_ITEMS, 10)
  const rps = Number.parseInt(args.rps ?? DEFAULT_RPS, 10)
  const duration = Number.parseInt(args.duration ?? DEFAULT_DURATION, 10)
  const apiKey = args.apiKey ?? process.env.API_KEY
  const headers = {
    accept: 'application/json',
    ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
  }
  const baseUrl = args.url ?? 'http://localhost:3000/api/discovery/search'

  const databaseUrl = args.databaseUrl ?? process.env.DATABASE_URL
  let pool
  if (args.seed || args.seed === 'true') {
    if (!databaseUrl) {
      console.error('DATABASE_URL is required to seed data.')
      process.exit(1)
    }
    pool = new Pool({ connectionString: databaseUrl })
    await seedData(pool, { clientId, items })
  }

  try {
    await runBenchmark({
      url: baseUrl,
      clientId,
      rps,
      duration,
      headers,
    })
  } finally {
    if (pool) {
      await pool.end()
    }
  }
}

main().catch((error) => {
  console.error('Benchmark failed:', error)
  process.exit(1)
})
