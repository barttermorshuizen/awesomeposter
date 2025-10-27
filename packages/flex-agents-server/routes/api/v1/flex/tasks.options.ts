import { getHeader, setHeader, sendNoContent } from 'h3'

export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  const requestedHeaders = getHeader(event, 'access-control-request-headers')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')
  setHeader(
    event,
    'Access-Control-Allow-Headers',
    requestedHeaders || 'content-type,accept,authorization,x-correlation-id'
  )
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')
  setHeader(event, 'Access-Control-Max-Age', '600')
  return sendNoContent(event, 204)
})
