import { AgentRuntime } from '../services/agent-runtime'
import { computeCompositeScore, agentThresholds } from '@awesomeposter/shared'
import { z } from 'zod'

const PlatformEnum = z.enum(['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok'])

export function registerQaTools(runtime: AgentRuntime) {
  runtime.registerTool({
    name: 'qa_evaluate_content',
    description: 'Evaluate content quality and compliance; return structured scores and suggestions',
    parameters: z
      .object({
        content: z.string(),
        platform: PlatformEnum,
        // Structured outputs limitation: use nullable instead of optional
        objective: z.string().nullable(),
        // Strict object to satisfy validator; include expected field(s)
        clientPolicy: z
          .object({
            bannedClaims: z.array(z.string()).nullable()
          })
          .strict()
          .catchall(z.never())
          .nullable()
      })
      .strict()
      .catchall(z.never()),
    handler: ({ content, platform, objective, clientPolicy }: { content: string; platform: z.infer<typeof PlatformEnum>; objective: string | null; clientPolicy: any | null }) => {
      const text = String(content || '').trim()
      const lower = text.toLowerCase()
      const length = text.length
      const lines = text.split(/\r?\n/)

      // Tokenization helpers
      const words = (text.match(/[A-Za-z0-9'’\-]+/g) || [])
      const wordCount = Math.max(1, words.length)
      const sentences = text.split(/(?<=[.!?])\s+/).filter(s => s.trim().length > 0)
      const sentenceCount = Math.max(1, sentences.length)
      const avgSentenceLen = wordCount / sentenceCount
      const longWordShare = (words.filter(w => w.length >= 7).length) / wordCount

      // Readability: sentence length, long-word share, overall length, and blockiness
      const lengthPenalty = length > 1300 ? Math.min(0.30, (length - 1300) / 3000) : 0
      const blockinessPenalty = (() => {
        const lb = lines.length - 1
        const avgPerBlock = length / Math.max(1, lb + 1)
        return Math.max(0, Math.min(0.10, (avgPerBlock - 220) / 2000))
      })()
      const sentencePenalty = Math.max(0, Math.min(0.40, (avgSentenceLen - 18) / 40))
      const longWordPenalty = Math.max(0, Math.min(0.30, longWordShare * 0.30 * 10)) // scale share to reasonable range
      const readability = Math.max(0, Math.min(1, 0.92 - (sentencePenalty + longWordPenalty + lengthPenalty + blockinessPenalty)))

      // Clarity: structure signals and style penalties
      const bulletCount = lines.filter(l => /^\s*([\-\*•]|\d+\.|\d+\))\s+/.test(l)).length
      const posSignals = Math.min(0.15, bulletCount * 0.04) + (length > 0 && (length / Math.max(1, lines.length)) < 140 ? 0.05 : 0)
      const capsWords = (words.filter(w => w.length >= 3 && w === w.toUpperCase()).length) / wordCount
      const capsPenalty = Math.min(0.15, capsWords * 0.4)
      const punctPenalty = Math.min(0.10, ((lower.match(/!{2,}|\?{2,}/g) || []).length) * 0.05)
      const fillerWords = ['very','really','just','actually','basically','obviously','clearly']
      const fillerPenalty = Math.min(0.10, fillerWords.reduce((acc, w) => acc + ((lower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length), 0) * 0.02)
      const duplicateLinePenalty = ((): number => {
        const seen = new Set<string>()
        for (const l of lines.map(s => s.trim().toLowerCase()).filter(Boolean)) {
          if (seen.has(l) && l.length > 8) return 0.05
          seen.add(l)
        }
        return 0
      })()
      const clarity = Math.max(0, Math.min(1, 0.60 + posSignals - (capsPenalty + punctPenalty + fillerPenalty + duplicateLinePenalty)))

      // Objective fit: token overlap with simple stopword filtering
      const stop = new Set(['the','a','an','of','for','and','to','in','on','with','by','is','are','be','as','that','this','it','at','from'])
      const obj = String(objective || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim()
      const objTokens = Array.from(new Set(obj.split(/\s+/).filter(t => t && !stop.has(t))))
      const contentTokens = new Set(lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t && !stop.has(t)))
      const overlap = objTokens.filter(t => contentTokens.has(t)).length
      const coverage = objTokens.length > 0 ? overlap / objTokens.length : 0
      const exactPhraseBoost = objTokens.length > 0 && lower.includes(String(objective || '').toLowerCase()) ? 0.05 : 0
      const objectiveFit = Math.max(0, Math.min(1, 0.55 + 0.40 * coverage + exactPhraseBoost))

      // Brand risk: client policy hits + claim patterns
      const hasPolicyHit = !!clientPolicy?.bannedClaims?.some?.((c: string) => lower.includes(String(c || '').toLowerCase()))
      let brandRisk = hasPolicyHit ? 0.60 : 0.10
      const riskyPhrases = [
        '100%', 'guarantee', 'guaranteed', 'no risk', 'get rich', 'fastest', 'best', 'never', 'always', 'proven', 'scientifically proven'
      ]
      const regulatedPhrases = [
        'cure', 'diagnose', 'treat', 'prevent', 'investment advice', 'financial advice', 'returns', 'profits', 'insider'
      ]
      const manipulativePhrases = [
        'click here', 'limited time', 'act now', "don't miss", 'only today'
      ]
      const pctClaims = (lower.match(/\b\d{2,}%\b/g) || []).length
      const growthWords = ['increase','boost','double','triple','explode']
      const growthMentions = growthWords.reduce((acc, w) => acc + ((lower.match(new RegExp(`\\b${w}\\b`, 'g')) || []).length), 0)
      const catHits = [
        riskyPhrases.some(p => lower.includes(p)),
        regulatedPhrases.some(p => lower.includes(p)),
        manipulativePhrases.some(p => lower.includes(p)),
        pctClaims > 0 || growthMentions > 0
      ].filter(Boolean).length
      brandRisk = Math.max(0, Math.min(1, brandRisk + (catHits > 0 ? 0.12 : 0) + Math.max(0, catHits - 1) * 0.06 + Math.min(0.10, (pctClaims + growthMentions) * 0.02) + (hasPolicyHit ? 0.15 : 0)))

      // Compliance aligned with shared thresholds
      const compliance = brandRisk <= agentThresholds.maxBrandRisk

      // Hook strength and CTA presence (auxiliary signals; not in composite)
      const firstLine = (text.split(/\r?\n/, 1)[0] || '').trim()
      const hookLower = firstLine.toLowerCase()
      let hookStrength = 0.50
      if (/\d/.test(firstLine)) hookStrength += 0.15
      if (firstLine.includes('?')) hookStrength += 0.10
      if (firstLine.includes('!')) hookStrength += 0.05
      const imperativeStarters = ['imagine','consider','stop','learn','meet','introducing','announce','announcing','discover','try']
      if (imperativeStarters.some(s => hookLower.startsWith(s))) hookStrength += 0.10
      if (firstLine.length < 8 || firstLine.length > 140) hookStrength -= 0.10
      if (firstLine === firstLine.toUpperCase() && firstLine.replace(/[^A-Za-z]/g, '').length >= 3) hookStrength -= 0.10
      hookStrength = Math.max(0, Math.min(1, hookStrength))

      const ctaPresence = /(learn more|sign up|follow|comment|share|download|try|register|join us|contact us|get started|read more|dm me|send me a dm)/i.test(text) ? 1 : 0

      // Centralized composite quality calculation (brand risk inversely applied)
      let composite = computeCompositeScore({ readability, clarity, objectiveFit, brandRisk }, { platform })
      // Optional gating: cap composite for non-compliant content
      if (!compliance) composite = Math.min(composite, 0.40)

      // Feedback and recommended changes
      const feedback: string[] = []
      if (length < 80) feedback.push('Content may be too short; add a concrete insight or example.')
      if (length > 1200) feedback.push('Content may be too long; tighten for scannability and focus.')
      if (avgSentenceLen > 22) feedback.push('Shorten long sentences to improve readability.')
      if (capsWords > 0.08) feedback.push('Avoid ALL‑CAPS words; use emphasis sparingly.')
      if (bulletCount === 0 && length > 600) feedback.push('Add bullets or short paragraphs to improve clarity.')
      if (!ctaPresence) feedback.push('Add a clear CTA aligned with the objective.')
      if (hasPolicyHit) feedback.push('Remove or rewrite claims that conflict with client policy.')
      if (brandRisk > agentThresholds.maxBrandRisk) feedback.push('Reduce brand risk: avoid absolute promises and regulated claims.')

      const revisionPriority = composite > 0.8 && compliance ? 'low' : composite > 0.6 ? 'medium' : 'high'
      const contentRecommendations = [...feedback]

      return {
        readability,
        clarity,
        objectiveFit,
        brandRisk,
        compliance,
        hookStrength,
        ctaPresence,
        feedback: feedback.join(' '),
        suggestedChanges: feedback,
        contentRecommendations,
        revisionPriority,
        composite
      }
    }
  })
}
