export type NormalizedDraft = {
  platform: string
  variantId: string
  post: string
  altText?: string
  charCount: number
}

export type NormalizedAppResult = {
  drafts: NormalizedDraft[]
  rationale?: string | null
  knobs?: unknown
  schedule?: unknown
}

type DraftLike = {
  platform?: unknown
  variantId?: unknown
  channel?: unknown
  post?: unknown
  content?: unknown
  text?: unknown
  altText?: unknown
}

/**
 * normalizeAppResult()
 * Best-effort normalization of arbitrary AppResult.result payloads into exactly 3 drafts.
 * - Prefers explicit result.drafts array if present
 * - Falls back to result.posts, result.variants, or platform maps
 * - If given a string, splits by double newlines into 3 paragraphs
 * - Pads or slices to ensure exactly 3 variants
 */
export function normalizeAppResult(result: unknown, rationale?: string | null): NormalizedAppResult {
  const drafts: NormalizedDraft[] = []

  const pushDraft = (platform: string, variantId: string, post: string, altText?: string) => {
    const text = String(post || '').trim()
    drafts.push({
      platform: platform || 'generic',
      variantId,
      post: text,
      altText: typeof altText === 'string' ? altText : undefined,
      charCount: text.length,
    })
  }

  // Case 0: array of items — treat as drafts-like list
  if (Array.isArray(result)) {
    const arr = result as unknown[]
    arr.forEach((item, i) => {
      const platform = (isRecord(item) ? (getStr(item as Record<string, unknown>, 'platform') ?? getStr(item as Record<string, unknown>, 'channel')) : undefined) || 'generic'
      const post = pickPostText(item as Record<string, unknown>)
      if (post) pushDraft(platform, String(i + 1), post)
    })
    return finalize({ drafts, rationale })
  }

  // Case 1: structured object
  if (result && typeof result === 'object') {
    const obj = result as Record<string, unknown>

    // Preserve auxiliary known fields
    const knobs = obj.knobs
    const schedule = obj.schedule

    // 1a) result.drafts: Array<{ platform, variantId, post, altText? }>
    const maybeDrafts = (obj as { drafts?: unknown }).drafts
    if (Array.isArray(maybeDrafts)) {
      for (let i = 0; i < (maybeDrafts as unknown[]).length; i++) {
        const d = (maybeDrafts as unknown[])[i] as DraftLike
        const platform = str(d?.platform, 'generic')
        const variantId = str(d?.variantId, String(i + 1))
        const post = pickPostText(d)
        const altText = typeof d?.altText === 'string' ? d.altText : undefined
        if (post) pushDraft(platform, variantId, post, altText)
      }
      return finalize({ drafts, rationale, knobs, schedule })
    }

    // 1b) result.posts: array of strings or objects with { post, platform? }
    const maybePosts = (obj as { posts?: unknown }).posts
    if (Array.isArray(maybePosts)) {
      ;(maybePosts as unknown[]).forEach((p, i) => {
        const item = p as DraftLike
        const platform = str(item?.platform, 'generic')
        const post = pickPostText(item)
        if (post) pushDraft(platform, String(i + 1), post)
      })
      return finalize({ drafts, rationale, knobs, schedule })
    }

    // 1c) result.posts: map of platform => string | string[] | { post }
    if (maybePosts && typeof maybePosts === 'object' && !Array.isArray(maybePosts)) {
      const map = maybePosts as Record<string, unknown>
      Object.entries(map).forEach(([platform, value]) => {
        if (Array.isArray(value)) {
          ;(value as unknown[]).forEach((v, i) => {
            const post = pickPostText(v as DraftLike | string)
            if (post) pushDraft(platform, String(i + 1), post)
          })
        } else {
          const post = pickPostText(value as DraftLike | string)
          if (post) pushDraft(platform, '1', post)
        }
      })
      return finalize({ drafts, rationale, knobs, schedule })
    }

    // 1d) result.variants: similar structure
    const maybeVariants = (obj as { variants?: unknown }).variants
    if (Array.isArray(maybeVariants)) {
      ;(maybeVariants as unknown[]).forEach((v, i) => {
        const item = v as DraftLike
        const platform = str(item?.platform ?? item?.channel, 'generic')
        const post = pickPostText(item)
        if (post) pushDraft(platform, String(i + 1), post)
      })
      return finalize({ drafts, rationale, knobs, schedule })
    }

    // 1e) Fallback for orchestrator heuristic: { analysis, knobs }
    if ('analysis' in obj || 'knobs' in obj) {
      const hint = summarizeKnobs(obj.knobs)
      for (let i = 0; i < 3; i++) {
        pushDraft('generic', String(i + 1), hint ? `Variant ${i + 1} — ${hint}` : `Variant ${i + 1}`)
      }
      return finalize({ drafts, rationale, knobs, schedule })
    }

    // 1f) Generic object with a content-like string
    const genericPost = pickPostText(obj as DraftLike)
    if (genericPost) {
      const parts = splitToThree(genericPost)
      parts.forEach((p, i) => pushDraft('generic', String(i + 1), p))
      return finalize({ drafts, rationale, knobs, schedule })
    }

    // If still empty, fall through to padding
    return finalize({ drafts, rationale, knobs, schedule })
  }

  // Case 2: string — try to parse embedded JSON (with or without code fences), else split into paragraphs
  if (typeof result === 'string') {
    const text = stripCodeFences(result)
    const parsed = tryParseJsonObject(text)
    if (parsed) {
      const inner = ('result' in parsed) ? (parsed['result'] as unknown) : (parsed as unknown)
      const r2 = ('rationale' in parsed && typeof parsed['rationale'] === 'string') ? (parsed['rationale'] as string) : null
      return normalizeAppResult(inner, rationale ?? r2)
    }
    const parts = splitToThree(text)
    parts.forEach((p, i) => pushDraft('generic', String(i + 1), p))
    return finalize({ drafts, rationale })
  }

  // Case 3: unknown — pad 3 empty variants
  return finalize({ drafts, rationale })
}

// Helpers

function finalize(base: { drafts: NormalizedDraft[]; rationale?: string | null; knobs?: unknown; schedule?: unknown }): NormalizedAppResult {
  let out = [...base.drafts]
  // Ensure exactly 3
  if (out.length > 3) out = out.slice(0, 3)
  while (out.length < 3) {
    out.push({
      platform: 'generic',
      variantId: String(out.length + 1),
      post: '',
      charCount: 0,
    })
  }
  return {
    drafts: out,
    rationale: base.rationale ?? null,
    knobs: base.knobs,
    schedule: base.schedule,
  }
}

function str(v: unknown, dflt = ''): string {
  return typeof v === 'string' ? v : dflt
}

function stripCodeFences(s: string): string {
  const t = String(s ?? '')
  if (t.startsWith('```')) {
    const last = t.lastIndexOf('```')
    const inner = last > 0 ? t.slice(3, last) : t
    // remove leading "json" language tag if present
    return inner.replace(/^\s*json\s*/i, '').trim()
  }
  return t
}

function tryParseJsonObject(s: string): Record<string, unknown> | null {
  const text = s.trim()
  try {
    const obj = JSON.parse(text)
    if (obj && typeof obj === 'object') return obj as Record<string, unknown>
  } catch {}
  // best-effort extraction of outermost brace region
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    try {
      const obj = JSON.parse(text.slice(first, last + 1))
      if (obj && typeof obj === 'object') return obj as Record<string, unknown>
    } catch {}
  }
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function getStr(o: Record<string, unknown>, k: string): string | undefined {
  return typeof o[k] === 'string' ? (o[k] as string) : undefined
}

function getNum(o: Record<string, unknown>, k: string): number | undefined {
  return typeof o[k] === 'number' ? (o[k] as number) : undefined
}

function getRecord(o: Record<string, unknown>, k: string): Record<string, unknown> | undefined {
  const v = o[k]
  return isRecord(v) ? v : undefined
}

function isKnobish(o: Record<string, unknown>): boolean {
  return Boolean(
    getStr(o, 'formatType') ||
    getNum(o, 'hookIntensity') !== undefined ||
    getNum(o, 'expertiseDepth') !== undefined ||
    getRecord(o, 'structure')
  )
}

function renderKnobDraft(o: Record<string, unknown>): string {
  const fmt = getStr(o, 'formatType') ?? 'text'
  const hookNum = getNum(o, 'hookIntensity')
  const hook = hookNum !== undefined ? `${Math.round(hookNum * 100)}%` : 'balanced'
  const depthNum = getNum(o, 'expertiseDepth')
  const depth = depthNum !== undefined ? `${Math.round(depthNum * 100)}%` : 'general'
  const struct = getRecord(o, 'structure')
  const len = struct ? getNum(struct, 'lengthLevel') : undefined
  const scan = struct ? getNum(struct, 'scanDensity') : undefined
  const parts: string[] = []
  parts.push(`Format: ${fmt}.`)
  parts.push(`Hook intensity: ${hook}. Expertise depth: ${depth}.`)
  if (typeof len === 'number') parts.push(`Length: ${Math.round(len * 100)}%.`)
  if (typeof scan === 'number') parts.push(`Scan density: ${Math.round(scan * 100)}%.`)
  return parts.join(' ') + ' Draft the post accordingly using these settings.'
}

function pickPostText(v: DraftLike | string | Record<string, unknown>): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const direct = getStr(o, 'post') ?? getStr(o, 'content') ?? getStr(o, 'text')
    if (typeof direct === 'string') return direct
    // If we received a knobs-like object instead of text, render a readable draft summary
    if (isKnobish(o)) return renderKnobDraft(o)
  }
  return ''
}

function splitToThree(s: string): string[] {
  const text = String(s || '').trim()
  if (!text) return ['', '', '']
  const paras = text.split(/\n{2,}/g).map((x) => x.trim()).filter(Boolean)
  if (paras.length >= 3) return paras.slice(0, 3)
  // Fallback: try sentences
  const sentences = text.split(/(?<=\.)\s+/g).map((x) => x.trim()).filter(Boolean)
  const picked = sentences.slice(0, 3)
  while (picked.length < 3) picked.push('')
  return picked
}

function summarizeKnobs(knobs: unknown): string {
  if (!knobs || typeof knobs !== 'object') return ''
  const k = knobs as Record<string, unknown>
  const fmt = typeof k.formatType === 'string' ? `format: ${k.formatType}` : ''
  const hook = typeof k.hookIntensity === 'number' ? `hook: ${Math.round(k.hookIntensity * 100)}%` : ''
  const depth = typeof k.expertiseDepth === 'number' ? `depth: ${Math.round(k.expertiseDepth * 100)}%` : ''
  const parts = [fmt, hook, depth].filter(Boolean)
  return parts.join(', ')
}