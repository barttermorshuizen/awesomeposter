#!/usr/bin/env node
import 'dotenv/config'
import { getDb, discoveryItems, discoveryScores, resetDiscoveryItemsToPending } from '@awesomeposter/db'
import { eq, isNull } from 'drizzle-orm'

async function main() {
  const batchSize = Number.parseInt(process.argv[2] || '250', 10)
  const db = getDb()

  const pending = await db
    .select({ id: discoveryItems.id })
    .from(discoveryItems)
    .leftJoin(discoveryScores, eq(discoveryItems.id, discoveryScores.itemId))
    .where(isNull(discoveryScores.itemId))
    .limit(batchSize)

  if (!pending.length) {
    console.log('✅ discovery-backfill-scores: no items require backfill.')
    return
  }

  const ids = pending.map((row) => row.id)
  await resetDiscoveryItemsToPending(ids)
  console.log(`🔁 discovery-backfill-scores: reset ${ids.length} item(s) to pending_scoring.`)
}

main().catch((error) => {
  console.error('❌ discovery-backfill-scores failed:', error)
  process.exitCode = 1
})
