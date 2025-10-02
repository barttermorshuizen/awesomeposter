import { eq, getDb, discoveryKeywords } from '@awesomeposter/db'
import type { DiscoveryKeywordUpdatedEvent } from '@awesomeposter/shared'
import { onDiscoveryEvent } from './discovery-events'

type CacheEntry = {
  keywords: string[]
  timestamp: number
}

const keywordCache = new Map<string, CacheEntry>()
let subscribed = false

function ensureSubscription() {
  if (subscribed) return
  onDiscoveryEvent((event) => {
    if (event.type === 'keyword.updated') {
      handleKeywordEvent(event)
    }
  })
  subscribed = true
}

function handleKeywordEvent(event: DiscoveryKeywordUpdatedEvent) {
  keywordCache.delete(event.payload.clientId)
}

export async function getKeywordThemesForClient(clientId: string) {
  ensureSubscription()
  const cached = keywordCache.get(clientId)
  if (cached) {
    return cached.keywords
  }

  const db = getDb()
  const rows = await db
    .select({ keyword: discoveryKeywords.keyword })
    .from(discoveryKeywords)
    .where(eq(discoveryKeywords.clientId, clientId))
    .orderBy(discoveryKeywords.keyword)

  const keywords = rows.map((row) => row.keyword)
  keywordCache.set(clientId, { keywords, timestamp: Date.now() })
  return keywords
}

export function clearKeywordThemeCache(clientId?: string) {
  if (clientId) {
    keywordCache.delete(clientId)
    return
  }
  keywordCache.clear()
}

export function __getKeywordThemeCacheSizeForTests() {
  return keywordCache.size
}
