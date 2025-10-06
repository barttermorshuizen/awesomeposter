import { eq } from 'drizzle-orm';
import { g as getDb, l as discoveryKeywords } from './client.mjs';
import { o as onDiscoveryEvent } from './discovery-events.mjs';

const keywordCache = /* @__PURE__ */ new Map();
let subscribed = false;
function ensureSubscription() {
  if (subscribed) return;
  onDiscoveryEvent((event) => {
    if (event.type === "keyword.updated") {
      handleKeywordEvent(event);
    }
  });
  subscribed = true;
}
function handleKeywordEvent(event) {
  keywordCache.delete(event.payload.clientId);
}
async function getKeywordThemesForClient(clientId) {
  ensureSubscription();
  const cached = keywordCache.get(clientId);
  if (cached) {
    return cached.keywords;
  }
  const db = getDb();
  const rows = await db.select({ keyword: discoveryKeywords.keyword }).from(discoveryKeywords).where(eq(discoveryKeywords.clientId, clientId)).orderBy(discoveryKeywords.keyword);
  const keywords = rows.map((row) => row.keyword);
  keywordCache.set(clientId, { keywords, timestamp: Date.now() });
  return keywords;
}

export { getKeywordThemesForClient as g };
//# sourceMappingURL=discovery-keyword-cache.mjs.map
