import { AgentRuntime } from '../services/agent-runtime'
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
      // Very basic heuristics; can be replaced with model-assisted checks
      const length = content.trim().length
      const readability = Math.max(0, Math.min(1, 0.9 - Math.max(0, (length - 800)) / 4000))
      const clarity = Math.max(0, Math.min(1, 0.6 + Math.min(0.3, content.split('\n').length / 50)))
      const objectiveFit = objective && content.toLowerCase().includes((objective || '').toLowerCase()) ? 0.8 : 0.6
      const brandRisk = clientPolicy?.bannedClaims?.some?.((c: string) => content.toLowerCase().includes(String(c).toLowerCase())) ? 0.6 : 0.1
      const compliance = brandRisk < 0.5
      const feedback: string[] = []
      if (length < 80) feedback.push('Content may be too short; consider adding a concrete insight or example.')
      if (length > 1200) feedback.push('Content may be too long; tighten for scannability.')
      if (brandRisk >= 0.5) feedback.push('Remove claims that conflict with client policy.')

      const composite = Math.max(0, Math.min(1, readability * 0.35 + clarity * 0.2 + objectiveFit * 0.35 - brandRisk * 0.2))
      const revisionPriority = composite > 0.8 && compliance ? 'low' : composite > 0.6 ? 'medium' : 'high'

      // Normalize recommendations as strings for orchestrator consumption
      const contentRecommendations = [...feedback]

      return {
        readability,
        clarity,
        objectiveFit,
        brandRisk,
        compliance,
        feedback: feedback.join(' '),
        suggestedChanges: feedback,
        contentRecommendations,
        revisionPriority,
        composite
      }
    }
  })
}
