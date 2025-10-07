import { defineEventHandler } from 'h3'

console.info('[dev-session] startup DEV_SESSION_USER=', process.env.DEV_SESSION_USER)

/**
 * Enables local benchmarking/dev runs without the full auth stack.
 * Set DEV_SESSION_USER to a JSON object, e.g.
 * {"id":"benchmark-user","clientIds":["<client-uuid>"]}.
 */
export default defineEventHandler((event) => {
  const raw = process.env.DEV_SESSION_USER
  if (!raw) return

  try {
    const user = JSON.parse(raw) as Record<string, unknown>
    if (!user || typeof user !== 'object') return

    const ctx = event.context as Record<string, unknown>
    const auth = (ctx.auth as Record<string, unknown> | undefined) ?? {}
    if (!auth.user) {
      auth.user = user
    }
    ctx.auth = auth
  } catch (error) {
    console.error('DEV_SESSION_USER parse failed', error)
  }
})
