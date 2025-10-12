import { getHeader, setHeader } from 'h3'

export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin') || '*'
  setHeader(event, 'Vary', 'Origin')
  setHeader(event, 'Access-Control-Allow-Origin', origin)
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'content-type,accept,authorization,x-correlation-id')
  setHeader(event, 'Access-Control-Max-Age', '600')
  event.node.res.statusCode = 204
  try {
    event.node.res.end()
  } catch {}
})
