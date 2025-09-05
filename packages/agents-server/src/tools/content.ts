import { AgentRuntime } from '../services/agent-runtime'
import { z } from 'zod'

const FormatEnum = z.enum(['text', 'single_image', 'multi_image', 'document_pdf', 'video'])
const PlatformEnum = z.enum(['linkedin', 'x', 'facebook', 'instagram', 'youtube', 'tiktok'])

// Strict knobs schema required by the Agents SDK JSON Schema validator
// - All fields required at the schema level; use nullable for optional semantics
// - additionalProperties must be false (use strict + catchall(z.never()))
const KnobsParamSchema = z
  .object({
    formatType: FormatEnum.nullable(),
    hookIntensity: z.number().min(0).max(1).nullable(),
    expertiseDepth: z.number().min(0).max(1).nullable(),
    structure: z
      .object({
        lengthLevel: z.number().min(0).max(1),
        scanDensity: z.number().min(0).max(1)
      })
      .strict()
      .catchall(z.never())
      .nullable()
  })
  .strict()
  .catchall(z.never())

export function registerContentTools(runtime: AgentRuntime) {
  // Minimal format rendering tool: apply simple structural transforms
  runtime.registerTool({
    name: 'apply_format_rendering',
    description: 'Apply format-specific rendering rules to the content',
    parameters: z.object({
      content: z.string(),
      formatType: FormatEnum
    }),
    handler: ({ content, formatType }: { content: string; formatType: z.infer<typeof FormatEnum> }) => {
      let post = content
      switch (formatType) {
        case 'document_pdf': {
          const lines = post.split('\n').filter(Boolean)
          const sections = ['📋 Overview', '🔍 Key Points', '💡 Insights', '🚀 Action Items']
          post = sections.map((s, i) => (lines[i] ? `${s}\n${lines[i]}` : '')).filter(Boolean).join('\n\n')
          break
        }
        case 'multi_image': {
          const lines = post.split('\n').filter(Boolean)
          const sections = ['🎯 Step 1', '🎯 Step 2', '🎯 Step 3', '✅ Result']
          post = sections.map((s, i) => (lines[i] ? `${s}\n${lines[i]}` : '')).filter(Boolean).join('\n\n')
          break
        }
        case 'single_image': {
          const lines = post.split('\n')
          post = `🖼️ ${lines[0] || ''}\n\n${lines.slice(1).join('\n')}`.trim()
          break
        }
        case 'video': {
          const lines = post.split('\n')
          post = `🎬 Hook: ${lines[0] || ''}\n\n▶️ Body:\n${lines.slice(1).join('\n')}\n\n🔔 CTA: Follow for more`
          break
        }
        case 'text':
        default: {
          // nudge to scannable sections
          post = post
            .split('\n')
            .map((ln) => (ln.length > 0 ? `• ${ln}` : ln))
            .join('\n')
          break
        }
      }

      return { content: post, formatType }
    }
  })

  // Platform optimization tool: enforce basic heuristics and platform-specific caps
  runtime.registerTool({
    name: 'optimize_for_platform',
    description: 'Optimize content for a target platform and knob settings',
    parameters: z
      .object({
        content: z.string(),
        platform: PlatformEnum,
        // Strict object with known fields; allow null to indicate no knobs provided
        knobs: KnobsParamSchema.nullable()
      })
      .strict()
      .catchall(z.never()),
    handler: ({ content, platform, knobs }: { content: string; platform: z.infer<typeof PlatformEnum>; knobs: any | null }) => {
      let post = content.trim()
      // crude max length guidance (can be refined 
      const maxChars: Record<z.infer<typeof PlatformEnum>, number> = {
        linkedin: 3000,
        x: 280,
        facebook: 63206,
        instagram: 2200,
        youtube: 5000,
        tiktok: 2200
      }
      const limit = maxChars[platform] || 3000
      if (post.length > limit) post = post.slice(0, limit - 3) + '...'

      // knob-sensitive tweaks (best-effort)
      const hook = knobs?.hookIntensity
      if (typeof hook === 'number') {
        if (hook > 0.7) post = post.replace(/^•\s*/gm, '⚡ ')
        else if (hook < 0.3) post = post.replace(/^•\s*/gm, '— ')
      }

      return { content: post, platform, length: post.length, knobs }
    }
  })
}
