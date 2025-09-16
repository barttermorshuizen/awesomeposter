import { defineEventHandler, getRequestURL } from 'h3'

// Lightweight request logger to help debug 500s with no visible logs.
// Enable by setting LOG_REQUESTS=1 when running the API server.
export default defineEventHandler((event) => {
  if (process.env.LOG_REQUESTS !== '1') return
  try {
    const url = getRequestURL(event)
    const path = url?.pathname || ''
    // Only log API routes to reduce noise
    if (!path.startsWith('/api')) return
    const start = Date.now()
    const method = (event.node.req.method || 'GET').toUpperCase()
    console.log(`[api] ${method} ${path}`)
    event.node.res.on('finish', () => {
      const ms = Date.now() - start
      console.log(`[api] -> ${method} ${path} ${event.node.res.statusCode} ${ms}ms`)
    })
  } catch {}
})

