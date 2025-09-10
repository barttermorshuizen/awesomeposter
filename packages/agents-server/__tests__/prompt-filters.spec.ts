// @vitest-environment node
import { describe, it, expect } from 'vitest'

import {
  ORCH_SYS_START,
  ORCH_SYS_END,
  stripSentinelSections,
  redactSentinelSections,
  dropOrchestrationArtifacts,
  composeInputFilter
} from '../src/utils/prompt-filters'

// Helper to assemble sentinel blocks
const S = ORCH_SYS_START
const E = ORCH_SYS_END

describe('stripSentinelSections', () => {
  it('removes sentinel-bounded sections and keeps other text intact', () => {
    const input = `Hello ${S} secret ${E} world`
    const out = stripSentinelSections(input)
    expect(out).toBe('Hello  world')
    expect(out).not.toContain(S)
    expect(out).not.toContain(E)
  })

  it('handles multiline content with multiple sentinel sections', () => {
    const input = `Top\n${S}
Block A line 1
Block A line 2
${E}\nMid\n${S}X${E}\nBottom`
    const out = stripSentinelSections(input)
    expect(out).toBe('Top\n\nMid\n\nBottom')
  })

  it('returns unchanged when no sentinel sections are present', () => {
    const input = 'No sentinels here.'
    const out = stripSentinelSections(input)
    expect(out).toBe(input)
  })

  it('edge cases: nested and malformed markers', () => {
    const nested = `A ${S} x ${S} y ${E} z ${E} B`
    const nestedOut = stripSentinelSections(nested)
    // Non-greedy removes first START..first END, leaving a lingering END for drop stage to catch
    expect(nestedOut).toContain(E)
    expect(nestedOut).toBe('A  z ' + E + ' B')

    const malformed = `A ${S} x y B`
    const malformedOut = stripSentinelSections(malformed)
    // No END -> unchanged
    expect(malformedOut).toBe(malformed)
  })
})

describe('redactSentinelSections', () => {
  it('replaces sentinel content with placeholder while preserving surrounding text', () => {
    const input = `X ${S} classified ${E} Y`
    const out = redactSentinelSections(input)
    expect(out).toBe('X <<<REDACTED_ORCH>>> Y')
    expect(out).not.toContain(S)
    expect(out).not.toContain(E)
  })

  it('handles multiline blocks and preserves external newlines', () => {
    const input = `A\n${S}
Hidden
${E}\nB`
    const out = redactSentinelSections(input)
    expect(out).toBe('A\n<<<REDACTED_ORCH>>>\nB')
  })
})

describe('dropOrchestrationArtifacts', () => {
  it('drops messages that become empty after stripping sentinel content', () => {
    const msg = { role: 'assistant', content: `${S} meta ${E}` }
    expect(dropOrchestrationArtifacts(msg as any)).toBe(false)
  })

  it('drops messages that contain only the redaction placeholder', () => {
    const msg = { role: 'assistant', content: '<<<REDACTED_ORCH>>>' }
    expect(dropOrchestrationArtifacts(msg as any)).toBe(false)
  })

  it('drops messages with lingering sentinel markers (e.g., malformed/nested)', () => {
    const msg = { role: 'assistant', content: `residual ${E}` }
    expect(dropOrchestrationArtifacts(msg as any)).toBe(false)
  })

  it('drops obvious tool schema/code-fenced parameter blobs', () => {
    const msg = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Spec:' },
        {
          type: 'text',
          text: '```json\n{"type":"object","properties":{"a":{"type":"string"}}}\n```'
        }
      ]
    }
    expect(dropOrchestrationArtifacts(msg as any)).toBe(false)
  })

  it('drops approval/administrative meta prompts not meant for next role', () => {
    const msg1 = { role: 'assistant', content: 'APPROVE' } // short, all-caps directive
    const msg2 = { role: 'assistant', content: 'Please PROCEED with tool call' } // directive + mentions tool
    expect(dropOrchestrationArtifacts(msg1 as any)).toBe(false)
    expect(dropOrchestrationArtifacts(msg2 as any)).toBe(false)
  })

  it('keeps briefId context user lines', () => {
    const msg = { role: 'user', content: 'context: briefId=abc_123' }
    expect(dropOrchestrationArtifacts(msg as any)).toBe(true)
  })

  it('keeps normal user text and mixed parts with some sentinel content', () => {
    const msg1 = { role: 'user', content: 'hello world' }
    expect(dropOrchestrationArtifacts(msg1 as any)).toBe(true)

    const msg2 = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'Keep this' },
        { type: 'text', text: `${S} hide ${E}` }
      ]
    }
    // After stripping, normalized contains "Keep this" -> keep
    expect(dropOrchestrationArtifacts(msg2 as any)).toBe(true)
  })
})

describe('composeInputFilter', () => {
  it('applies base filter, strips sentinels, prunes empties, and drops artifacts', async () => {
    // Base filter that removes system messages
    const base = (history: any[]) => history.filter((m) => m.role !== 'system')
    const filter = composeInputFilter(base)

    const history = [
      // system message should be removed by base filter
      { role: 'system', content: `sys ${S} orchestrator guidance ${E} should not appear` },
      // user briefId context must be preserved
      { role: 'user', content: 'briefId=br123' },
      // user objective with sentinel junk that must be stripped
      { role: 'user', content: `Objective: write post. ${S} cross-role junk ${E}` },
      // assistant tool schema blob should be dropped
      { role: 'assistant', content: '```json\n{"type":"object","properties":{}}\n```' },
      // assistant fully-sentinel should be dropped after stripping -> empty
      { role: 'assistant', content: `${S} hidden ${E}` },
      // assistant mixed parts: textual + sentinel textual + non-textual
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Keep' },
          { type: 'text', text: `${S} remove ${E}` },
          { type: 'image', url: 'http://example/image.png' }
        ]
      },
      // assistant non-textual only -> dropped (normalizes to empty text)
      {
        role: 'assistant',
        content: [{ type: 'image', url: 'http://example/only-image.png' }]
      }
    ]

    const result = await filter(history as any)

    // No system messages
    expect(result.every((m: any) => m.role !== 'system')).toBe(true)
    // No sentinel markers or code fences remain
    const asText = (m: any) =>
      typeof m.content === 'string'
        ? m.content
        : Array.isArray(m.content)
          ? m.content.map((p: any) => (typeof p?.text === 'string' ? p.text : '')).join(' ')
          : ''
    const joined = result.map(asText).join('\n')
    expect(joined).not.toContain(S)
    expect(joined).not.toContain(E)
    expect(joined).not.toContain('```')

    // Brief context preserved
    expect(result.some((m: any) => m.role === 'user' && /briefId=br123/.test(asText(m)))).toBe(true)

    // User objective retained sans sentinel junk
    const obj = result.find((m: any) => m.role === 'user' && asText(m).startsWith('Objective:'))
    expect(obj).toBeTruthy()
    expect(asText(obj!)).toBe('Objective: write post. ')

    // Mixed parts message retained with sentinel textual part pruned
    const mixed = result.find((m: any) => Array.isArray(m.content))
    expect(mixed).toBeTruthy()
    const parts = (mixed!.content as any[]).filter((p) => typeof p?.text === 'string')
    expect(parts.length).toBe(1)
    expect(parts[0].text).toBe('Keep')

    // Ensure artifacts removed: tool schema blob, sentinel-only, non-textual-only
    expect(result.some((m: any) => /type":"object/.test(asText(m)))).toBe(false)
    expect(result.some((m: any) => asText(m) === '')).toBe(false)
  })
})