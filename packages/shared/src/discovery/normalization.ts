import type { DiscoveryPublishedAtSource } from '../discovery.js'

// Character replacements to keep output ASCII-friendly per repo standards.
const SMART_CHAR_MAP: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201C': '"',
  '\u201D': '"',
  '\u2014': '--',
  '\u2013': '-',
  '\u2026': '...',
  '\u00A0': ' ',
  '\u2009': ' ',
  '\u200A': ' ',
  '\u200B': '',
}

const ENTITY_MAP: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/g

const HTML_COMMENT_REGEX = /<!--([\s\S]*?)-->/g

const TAGS_TO_STRIP = ['script', 'style', 'noscript', 'template', 'iframe']
const BOILERPLATE_TAGS = ['nav', 'header', 'footer', 'aside', 'form']

function replaceSmartCharacters(input: string): string {
  return input.replace(/[\u2018\u2019\u201C\u201D\u2014\u2013\u2026\u00A0\u2009\u200A\u200B]/g, (match) => SMART_CHAR_MAP[match] ?? '')
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const codePoint = Number.parseInt(hex, 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    })
    .replace(/&#(\d+);/g, (_, num) => {
      const codePoint = Number.parseInt(num, 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : ''
    })
    .replace(/&([a-z]+);/gi, (_, entity) => ENTITY_MAP[entity.toLowerCase()] ?? `&${entity};`)
}

function stripTags(html: string, tagNames: string[]): string {
  return tagNames.reduce((acc, tag) => acc.replace(new RegExp(`<${tag}[^>]*>[\s\S]*?<\/${tag}>`, 'gi'), ' '), html)
}

function stripBoilerplate(html: string): string {
  let output = html.replace(HTML_COMMENT_REGEX, ' ')
  output = stripTags(output, TAGS_TO_STRIP)
  output = stripTags(output, BOILERPLATE_TAGS)
  return output
}

function extractText(html: string): string {
  const withoutBoilerplate = stripBoilerplate(html)
  const withoutTags = withoutBoilerplate.replace(/<br\s*\/?>/gi, '\n').replace(/<p[^>]*>/gi, '\n').replace(/<[^>]+>/g, ' ')
  const decoded = decodeEntities(withoutTags)
  const ascii = replaceSmartCharacters(decoded)
  return ascii
    .replace(/[\t\r\f\v]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

export function truncatePreservingSentences(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text
  }

  const sentences = text.split(SENTENCE_SPLIT_REGEX)
  const pieces: string[] = []
  let total = 0

  for (const sentence of sentences) {
    const candidate = sentence.trim()
    if (!candidate) continue
    const addedLength = candidate.length + (pieces.length > 0 ? 1 : 0)
    if (total + addedLength > maxLength) {
      break
    }
    pieces.push(candidate)
    total += addedLength
  }

  if (!pieces.length) {
    return text.slice(0, maxLength).trimEnd()
  }

  return pieces.join(' ')
}

export function sanitizeHtmlContent(html: string, maxLength = 5_000) {
  const text = extractText(html)
  const cleaned = stripResidualBoilerplate(text)
  const truncated = truncatePreservingSentences(cleaned, maxLength)
  return truncated
}

function stripResidualBoilerplate(text: string) {
  let trimmed = text.trimStart()
  const keywords = ['navigation', 'menu', 'advertisement']
  for (const keyword of keywords) {
    const lower = trimmed.toLowerCase()
    const index = lower.indexOf(keyword)
    if (index === -1) continue
    const fragment = trimmed.slice(index)
    const pattern = new RegExp(`^${keyword}(?:\\s+[A-Za-z][^\\s]*)*`, 'i')
    const match = fragment.match(pattern)
    if (match) {
      trimmed = `${trimmed.slice(0, index)}${fragment.slice(match[0].length)}`.trimStart()
    }
  }
  return trimmed
}

export function createExcerpt(text: string, maxLength = 320) {
  if (!text) return null
  const truncated = truncatePreservingSentences(text, maxLength)
  return truncated.length === text.length ? truncated : `${truncated}...`
}

export function normalizeTitle(rawTitle: string | null | undefined) {
  if (!rawTitle) return null
  return replaceSmartCharacters(decodeEntities(rawTitle)).trim() || null
}

export function derivePublishedAt(
  candidates: Array<string | null | undefined>,
  fallback: Date,
  candidateSource: DiscoveryPublishedAtSource = 'original',
  fallbackSource: DiscoveryPublishedAtSource = 'fallback',
): { publishedAt: string | null; source: DiscoveryPublishedAtSource } {
  for (const candidate of candidates) {
    if (!candidate) continue
    const trimmed = candidate.trim()
    if (!trimmed) continue
    const parsed = new Date(trimmed)
    if (Number.isNaN(parsed.getTime())) continue
    return { publishedAt: parsed.toISOString(), source: candidateSource }
  }
  return { publishedAt: fallback.toISOString(), source: fallbackSource }
}

export function extractMetaContent(html: string, keys: string[]): string | null {
  const pattern = /<meta\s+([^>]+)>/gi
  let match: RegExpExecArray | null
  const normalizedKeys = keys.map((key) => key.toLowerCase())
  while ((match = pattern.exec(html)) !== null) {
    const attrs = match[1]
    const nameMatch = /(?:name|property)\s*=\s*"([^"]+)"/i.exec(attrs) || /(?:name|property)\s*=\s*'([^']+)'/i.exec(attrs)
    if (!nameMatch) continue
    const key = nameMatch[1]?.toLowerCase()
    if (!key || !normalizedKeys.includes(key)) continue
    const contentMatch = /content\s*=\s*"([^"]*)"/i.exec(attrs) || /content\s*=\s*'([^']*)'/i.exec(attrs)
    if (contentMatch) {
      return decodeEntities(contentMatch[1] ?? '')
    }
  }
  return null
}

export function stripHtml(html: string) {
  return extractText(html)
}

export function ensureAscii(input: string): string {
  return replaceSmartCharacters(input)
}
