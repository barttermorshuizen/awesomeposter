import { getHeader, setHeader, sendNoContent } from 'h3'

export default defineEventHandler((event) => {
  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
  }
  const requestedHeaders = getHeader(event, 'access-control-request-headers')
  setHeader(event, 'Access-Control-Allow-Headers', requestedHeaders || 'accept,authorization,content-type')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')
  setHeader(event, 'Access-Control-Max-Age', 600)
  return sendNoContent(event, 204)
})
