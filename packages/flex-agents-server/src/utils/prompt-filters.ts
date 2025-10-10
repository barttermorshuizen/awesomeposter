/**
 * Prompt filtering utilities to support sentinel-based redaction and handoff input filtering.
 * Follows the design in docs/prompt-filtering.md
 */

export const ORCH_SYS_START = '<<<AP_ORCH_SYS_START>>>'
export const ORCH_SYS_END = '<<<AP_ORCH_SYS_END>>>'

const SENTINEL_REGEX = /<<<AP_ORCH_SYS_START>>>[\s\S]*?<<<AP_ORCH_SYS_END>>>/g

type Role = 'system' | 'user' | 'assistant' | (string & {})

export type MessagePart = { type: string; text?: string; [k: string]: any }
export type HistoryMessage = { role: Role; content: string | MessagePart[]; [k: string]: any }
export type InputFilter = (history: HistoryMessage[]) => Promise<HistoryMessage[]> | HistoryMessage[]

/**
 * Remove any content between orchestrator sentinel markers, inclusive.
 * Regex per plan: /<<<AP_ORCH_SYS_START>>>[\s\S]*?<<<AP_ORCH_SYS_END>>>/g
 */
export function stripSentinelSections(text: string): string {
  if (!text) return ''
  return text.replace(SENTINEL_REGEX, '')
}

/**
 * Redact sentinel-bounded sections with a placeholder while attempting to
 * preserve surrounding formatting (adds newlines if the block had them).
 */
export function redactSentinelSections(text: string): string {
  if (!text) return ''
  return text.replace(SENTINEL_REGEX, (match) => {
    const leadingNL = match.startsWith('\n') ? '\n' : ''
    const trailingNL = match.endsWith('\n') ? '\n' : ''
    return `${leadingNL}<<<REDACTED_ORCH>>>${trailingNL}`
  })
}

const TEXTUAL_PART_TYPES = new Set([
  'text',
  'output_text',
  'input_text',
  'input_text_delta',
  'output_text_delta'
])

function isTextualPart(p: any): p is MessagePart {
  return p && typeof p === 'object' && TEXTUAL_PART_TYPES.has(String(p.type || ''))
}

function normalizeTextFromMessage(msg: HistoryMessage): string {
  const content = (msg as any)?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((p) => (isTextualPart(p) && typeof p.text === 'string' ? p.text : ''))
      .join(' ')
  }
  return ''
}

function looksLikeToolSchema(text: string): boolean {
  const t = String(text || '').trim()
  if (!t) return false

  // Common JSON-schema-ish patterns frequently present in tool specs
  const schemaRe = /["']?(parameters|schema|jsonschema|openapi|properties|required|title)["']?\s*:/i
  const typeObjectRe = /["']type["']\s*:\s*["']object["']/i

  // 1) Check any fenced code block and inspect its inner content
  const fenceRe = /```[\w-]*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fenceRe.exec(t))) {
    const block = m[1] || ''
    if (schemaRe.test(block) || typeObjectRe.test(block)) return true
  }

  // 2) If the entire string is just JSON-like, check it directly
  if (/^\s*\{[\s\S]*\}\s*$/.test(t) && (schemaRe.test(t) || typeObjectRe.test(t))) {
    return true
  }

  return false
}

function looksLikeApprovalMeta(text: string): boolean {
  const t = text.trim()
  if (!t) return false
  // Strong signals: short, all-caps directive lines around approval/rejection
  const lettersOnly = t.replace(/[^A-Za-z]+/g, '')
  const isAllCaps = lettersOnly.length > 0 && /^[A-Z]+$/.test(lettersOnly)
  const short = t.length <= 120 && t.split(/\s+/).length <= 14
  const directive = /\b(APPROVE|DECLINE|CONFIRM|PROCEED|REJECT|ALLOW|DENY)\b/.test(t)
  const mentionsTool = /\b(tool|call|execution|action|operation)\b/i.test(t)
  return (isAllCaps && directive) || (directive && mentionsTool && short)
}

/**
 * Return true to keep a message, false to drop it from history.
 * Drops:
 *  - messages that become empty after stripping sentinel sections
 *  - tool schema/code-fenced parameter blobs
 *  - approval/administrative meta prompts not meant for the next role
 * Always keeps briefId context user lines.
 */
export function dropOrchestrationArtifacts(msg: HistoryMessage): boolean {
  // Keep briefId context user line regardless
  const rawText = normalizeTextFromMessage(msg)
  const stripped = stripSentinelSections(rawText)
  const normalized = stripped.replace(/\u200b/g, '').trim()

  // Always keep briefId context hints
  const hasBriefIdLine = /\bbriefId\s*=\s*[-_A-Za-z0-9]+\b/.test(normalized)
  if (msg?.role === 'user' && hasBriefIdLine) return true

  // Drop if empty or only placeholder
  if (!normalized) return false
  if (normalized === '<<<REDACTED_ORCH>>>') return false

  // Drop lingering sentinel markers
  if (normalized.includes(ORCH_SYS_START) || normalized.includes(ORCH_SYS_END)) return false

  // Drop obvious tool schema/code-fenced parameter blobs
  if (looksLikeToolSchema(normalized)) return false

  // Drop approval/administrative meta not meant for the next role
  if (looksLikeApprovalMeta(normalized)) return false

  // Otherwise, keep
  return true
}

/**
 * Compose an inputFilter compatible with the OpenAI Agents SDK.
 * Applies the provided baseFilter first (e.g., filterHistory), then
 * strips sentinel sections from textual parts, prunes empty parts,
 * and drops orchestration artifacts.
 */
export function composeInputFilter(baseFilter?: InputFilter): InputFilter {
  return async (history: HistoryMessage[]) => {
    const base = baseFilter ? await baseFilter(history) : history
    const mapped = base.map((msg) => {
      const c = (msg as any).content
      if (typeof c === 'string') {
        const text = stripSentinelSections(c)
        return { ...msg, content: text }
      }
      if (Array.isArray(c)) {
        const newParts = c
          .map((p) => {
            if (isTextualPart(p)) {
              const nextText = stripSentinelSections(p.text || '')
              return { ...p, text: nextText }
            }
            return p
          })
          // prune empty textual parts
          .filter((p) => !isTextualPart(p) || (typeof p.text === 'string' && p.text.trim().length > 0))
        return { ...msg, content: newParts }
      }
      return msg
    })

    const filtered = mapped.filter((m) => dropOrchestrationArtifacts(m))

    // Remove messages whose content ended up empty arrays after pruning
    const finalHistory = filtered.filter((m) => {
      const c = (m as any).content
      if (typeof c === 'string') return c.trim().length > 0
      if (Array.isArray(c)) return c.length > 0
      return true
    })

    return finalHistory
  }
}