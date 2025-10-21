import { getHeader, setHeader } from 'h3'

export default defineEventHandler((event) => {
  const path = event.path || ''
  if (!path.startsWith('/api/')) return

  const req = event.node.req
  const res = event.node.res
  const origin = getHeader(event, 'origin') || ''

  // Build allowlist from env; comma-separated
  const raw = process.env.CORS_ALLOW_ORIGINS || process.env.CORS_ALLOWLIST || ''
  const allowlist = (raw ? raw.split(',') : []).map((s) => s.trim()).filter(Boolean)
  const usingCustomAllowlist = allowlist.length > 0
  const defaults = usingCustomAllowlist
    ? []
    : process.env.NODE_ENV !== 'production'
      ? ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5173']
      : []
  const finalAllowlist = allowlist.length > 0 ? allowlist : defaults

  const isAllowed = (o: string) => {
    if (!o) return false
    if (finalAllowlist.includes('*')) return true
    if (finalAllowlist.includes(o)) return true
    try {
      const parsed = new URL(o)
      const hostname = parsed.hostname.toLowerCase()
      const isLocalHost = hostname === 'localhost' || hostname === '127.0.0.1'
      if (isLocalHost && !usingCustomAllowlist && process.env.NODE_ENV !== 'production') {
        // In local dev allow any localhost/127.0.0.1 port by default
        return true
      }
    } catch {
      // ignore malformed origins
    }
    return false
  }

  if (!origin || !isAllowed(origin)) {
    // No CORS headers for non-allowed or non-CORS requests
    return
  }

  // Minimal, strict CORS for browser clients
  setHeader(event, 'Vary', 'Origin')
  setHeader(event, 'Access-Control-Allow-Origin', origin)
  const requestedHeaders = getHeader(event, 'access-control-request-headers')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  setHeader(
    event,
    'Access-Control-Allow-Headers',
    requestedHeaders || 'accept,content-type,authorization,x-correlation-id'
  )
  setHeader(event, 'Access-Control-Max-Age', '600')

  // Short-circuit preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.end()
  }
})
