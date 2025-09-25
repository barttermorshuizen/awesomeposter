import type { H3Event } from 'h3'
import { getHeader, createError } from 'h3'
export function requireApiAuth(event: H3Event) {
  const expected = process.env.API_KEY
  if (!expected) return
  const header = getHeader(event, 'authorization') || ''
  if (!header.startsWith('Bearer ')) {
    throw createError({ statusCode: 401, statusMessage: 'Missing bearer token' })
  }
  const token = header.slice('Bearer '.length)
  if (token !== expected) {
    throw createError({ statusCode: 403, statusMessage: 'Invalid API key' })
  }
}
