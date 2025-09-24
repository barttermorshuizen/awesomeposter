import type { AgentEvent, AgentRunRequest } from '@awesomeposter/shared'

export type AgentEventWithId = AgentEvent & { id?: string }

export type PostEventStreamOptions = {
  url: string
  body: AgentRunRequest
  headers?: Record<string, string>
  onEvent: (frame: AgentEventWithId) => void
  maxRetries?: number
  retryBaseMs?: number
  signal?: AbortSignal
  onBackoff?: (info: { retryAfter: number; attempt: number; pending?: number; limit?: number }) => void
  onCorrelationId?: (cid: string) => void
}

/**
 * POST to an SSE endpoint and stream AgentEvent frames with backoff and cancellation.
 * Returns an object with abort() and a done promise that resolves when the stream finishes.
 */
export function postEventStream(opts: PostEventStreamOptions): { abort: () => void; done: Promise<void> } {
  const {
    url,
    body,
    headers = {},
    onEvent,
    maxRetries = 2,
    retryBaseMs = 1000,
    signal,
    onBackoff,
    onCorrelationId,
  } = opts

  const internal = new AbortController()
  const extSignal = signal
  const onAbort = () => internal.abort()
  extSignal?.addEventListener('abort', onAbort, { once: true })

  let stopped = false
  let correlationId: string | undefined

  const done = (async () => {
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (stopped) break

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...headers,
          },
          body: JSON.stringify(body),
          signal: internal.signal,
        })

        if (!res.ok) {
          // Backlog handling: 503 with Retry-After and X-Backlog-* headers
          if (res.status === 503 && attempt < maxRetries) {
            const retryAfterSec = parseInt(res.headers.get('Retry-After') || '2', 10)
            const pending = parseInt(res.headers.get('X-Backlog-Pending') || '0', 10)
            const limit = parseInt(res.headers.get('X-Backlog-Limit') || '0', 10)
            if (typeof onBackoff === 'function') {
              onBackoff({ retryAfter: retryAfterSec, attempt, pending, limit })
            }
            const baseDelay = Math.max(retryBaseMs, retryAfterSec * 1000)
            await sleep(baseDelay * (attempt + 1))
            continue
          }

          // Emit a synthetic error frame and stop
          const text = await res.text().catch(() => '')
          onEvent({
            type: 'error',
            message: `HTTP ${res.status} ${res.statusText}`,
            data: { body: text },
          })
          break
        }

        // Stream and parse SSE
        const reader = res.body?.getReader()
        if (!reader) {
          onEvent({ type: 'error', message: 'No readable response body for SSE' })
          break
        }

        try {
          await parseSse(reader, (evt) => {
            // Capture correlationId the first time we see it
            if (!correlationId && typeof evt.correlationId === 'string') {
              correlationId = evt.correlationId
              if (typeof onCorrelationId === 'function') onCorrelationId(correlationId)
            }
            onEvent(evt)
          })
        } catch (err: unknown) {
          const name = (err as { name?: string } | null)?.name
          if (name === 'AbortError') {
            onEvent({ type: 'warning', message: 'Stream aborted by user' })
          } else {
            onEvent({ type: 'error', message: String(err) })
          }
        }
        break // streamed successfully or ended; do not retry
      }
    } finally {
      extSignal?.removeEventListener('abort', onAbort)
    }
  })()

  return {
    abort() {
      stopped = true
      internal.abort()
    },
    done,
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Minimal SSE line parser compatible with the server implementation.
 * Dispatches AgentEvent frames; ignores comment/heartbeat lines.
 */
async function parseSse(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onEvent: (evt: AgentEventWithId) => void
) {
  const decoder = new TextDecoder()
  let buf = ''
  let eventType: string | undefined
  let eventId: string | undefined
  let dataLines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })

    // process by lines
    while (true) {
      const nl = buf.indexOf('\n')
      if (nl === -1) break
      let line = buf.slice(0, nl)
      buf = buf.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)

      if (line === '') {
        // dispatch event
        if (dataLines.length > 0) {
          const dataStr = dataLines.join('\n')
          let data: unknown
          try {
            data = JSON.parse(dataStr)
          } catch {
            data = { raw: dataStr }
          }
          const partial = (data ?? {}) as Partial<AgentEventWithId>
          const t = (partial.type as AgentEvent['type']) ?? (eventType as AgentEvent['type']) ?? 'message'
          const payload: AgentEventWithId = { type: t, id: eventId }
          if (typeof partial.message === 'string') payload.message = partial.message
          if (partial.phase) payload.phase = partial.phase as AgentEvent['phase']
          if ('data' in partial) payload.data = (partial as { data?: unknown }).data
          if (typeof partial.tokens === 'number') payload.tokens = partial.tokens
          if (typeof partial.durationMs === 'number') payload.durationMs = partial.durationMs
          if (typeof partial.correlationId === 'string') payload.correlationId = partial.correlationId
          onEvent(payload)
        }
        eventType = undefined
        eventId = undefined
        dataLines = []
        continue
      }

      if (line.startsWith(':')) continue // comment/heartbeat prelude
      if (line.startsWith('event:')) eventType = line.slice(6).trim()
      else if (line.startsWith('id:')) eventId = line.slice(3).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      // ignore other fields
    }
  }
}
