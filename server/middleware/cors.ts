import { defineEventHandler, getHeader, setHeader, getMethod, sendNoContent } from 'h3'

export default defineEventHandler((event) => {
  const originHeader = getHeader(event, 'origin')
  const origin = originHeader || process.env.VITE_DEV_SERVER_ORIGIN || 'http://localhost:5173'
  setHeader(event, 'Vary', 'Origin')
  setHeader(event, 'Access-Control-Allow-Origin', origin)
  setHeader(event, 'Access-Control-Allow-Methods', getHeader(event, 'access-control-request-method') || 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
  const requestedHeaders = getHeader(event, 'access-control-request-headers')
  const allowHeaders = requestedHeaders || 'Content-Type, Accept, Authorization, X-Correlation-Id'
  setHeader(event, 'Access-Control-Allow-Headers', allowHeaders)
  if (originHeader) {
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  setHeader(event, 'Access-Control-Expose-Headers', 'content-type,x-correlation-id')

  if (getMethod(event) === 'OPTIONS') {
    setHeader(event, 'Access-Control-Max-Age', '600')
    return sendNoContent(event, 204)
  }
})
