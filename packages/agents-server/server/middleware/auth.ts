export default defineEventHandler((event) => {
  if (!event.path?.startsWith('/api/')) return
  // Always let CORS preflight pass
  if (event.node.req.method === 'OPTIONS') return
  const expected = process.env.API_KEY
  if (!expected) return // Do not enforce in local dev unless API_KEY is set
  const header = getHeader(event, 'authorization') || ''
  if (!header.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing bearer token' })
  }
  const token = header.slice('Bearer '.length)
  if (token !== expected) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid API key' })
  }
})
