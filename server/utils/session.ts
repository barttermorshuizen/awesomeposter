import type { H3Event } from 'h3'
import { createError } from 'h3'

export type SessionUser = {
  id: string
  email?: string | null
  clientId?: string | null
  clientIds?: string[] | null
  roles?: string[] | null
  permissions?: string[] | null
  [key: string]: unknown
}

function isSessionUser(value: unknown): value is SessionUser {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.id === 'string' && candidate.id.length > 0
}

export function requireUserSession(event: H3Event): SessionUser {
  const ctx = (event.context as { auth?: { user?: unknown }; session?: { user?: unknown } }) || {}
  const userCandidate = ctx.auth?.user ?? ctx.session?.user
  if (!isSessionUser(userCandidate)) {
    throw createError({ statusCode: 401, statusMessage: 'Authentication required' })
  }
  return userCandidate
}

export function assertClientAccess(user: SessionUser, clientId: string): void {
  if (!clientId) return
  const allowed: string[] | null = Array.isArray(user.clientIds)
    ? user.clientIds
    : typeof user.clientId === 'string' && user.clientId.length > 0
      ? [user.clientId]
      : null
  if (allowed && !allowed.includes(clientId)) {
    throw createError({ statusCode: 403, statusMessage: 'Forbidden' })
  }
}
