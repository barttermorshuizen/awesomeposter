import { getKeywordThemesForClient } from './discovery-keyword-cache'

export type DiscoveryVariant = {
  id: string
  content: string
  platform: string
}

export type ScoredDiscoveryVariant = DiscoveryVariant & {
  score: number
}

const KEYWORD_BONUS_PER_MATCH = 0.1
const MAX_KEYWORD_BONUS = 0.4
const LONG_CONTENT_THRESHOLD = 120
const LONG_CONTENT_SCORE = 0.6
const SHORT_CONTENT_SCORE = 0.4

function normalizeContent(content: string) {
  return content.toLowerCase()
}

function toBonus(matchCount: number) {
  return Math.min(MAX_KEYWORD_BONUS, matchCount * KEYWORD_BONUS_PER_MATCH)
}

export async function scoreDiscoveryVariants(
  clientId: string,
  variants: DiscoveryVariant[],
): Promise<ScoredDiscoveryVariant[]> {
  if (!variants.length) return []

  const keywords = await getKeywordThemesForClient(clientId)
  const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase())

  const scored = variants.map((variant) => {
    const content = normalizeContent(variant.content)
    const matchCount = normalizedKeywords.reduce((count, keyword) => {
      if (!keyword) return count
      return content.includes(keyword) ? count + 1 : count
    }, 0)

    const keywordBonus = toBonus(matchCount)
    const baseScore = variant.content.length > LONG_CONTENT_THRESHOLD ? LONG_CONTENT_SCORE : SHORT_CONTENT_SCORE
    const totalScore = Math.min(1, parseFloat((baseScore + keywordBonus).toFixed(3)))
    return {
      ...variant,
      score: totalScore,
    }
  })

  return scored.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
}
