import type { FlexEvent } from '@awesomeposter/shared'

export type FlexEventWithId = FlexEvent & { id?: string }

export type PostFlexStreamOptions = {
  url: string
  body: unknown
  headers?: Record<string, string>
  onEvent: (frame: FlexEventWithId) => void
  signal?: AbortSignal
  onBackoff?: (info: { retryAfter: number; attempt: number; pending?: number; limit?: number }) => void
  onCorrelationId?: (cid: string) => void
  maxRetries?: number
  retryBaseMs?: number
}

export function postFlexEventStream(opts: PostFlexStreamOptions): { abort: () => void; done: Promise<void> } {
  const {
    url,
    body,
    headers = {},
    onEvent,
    signal,
    onBackoff,
    onCorrelationId,
    maxRetries = 2,
    retryBaseMs = 1000
  } = opts

  const controller = new AbortController()
  const external = signal
  const abortHandler = () => controller.abort()
  external?.addEventListener('abort', abortHandler, { once: true })

  let stopped = false
  let correlationId: string | undefined

  const emitLog = (message: string, extra?: Partial<FlexEventWithId>) => {
    onEvent({
      type: 'log',
      timestamp: new Date().toISOString(),
      message,
      ...extra
    })
  }

  const done = (async () => {
    try {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (stopped) break

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...headers
          },
          body: JSON.stringify(body),
          signal: controller.signal
        })

        if (!res.ok) {
          if (res.status === 503 && attempt < maxRetries) {
            const retryAfterSec = parseInt(res.headers.get('Retry-After') || '2', 10)
            const pending = parseInt(res.headers.get('X-Backlog-Pending') || '0', 10)
            const limit = parseInt(res.headers.get('X-Backlog-Limit') || '0', 10)
            onBackoff?.({ retryAfter: retryAfterSec, attempt, pending, limit })
            const delay = Math.max(retryBaseMs, retryAfterSec * 1000)
            await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)))
            continue
          }

          const text = await res.text().catch(() => '')
          emitLog(`HTTP ${res.status} ${res.statusText}`, { payload: { body: text } })
          break
        }

        const reader = res.body?.getReader()
        if (!reader) {
          emitLog('No readable response body for SSE')
          break
        }

        try {
          await parseFlexSse(reader, (evt) => {
            if (!correlationId && typeof evt.correlationId === 'string') {
              correlationId = evt.correlationId
              onCorrelationId?.(correlationId)
            }
            onEvent(evt)
          })
        } catch (err: unknown) {
          const name = (err as { name?: string } | null)?.name
          if (name === 'AbortError') {
            emitLog('Stream aborted by user')
          } else {
            emitLog(String(err))
          }
        }
        break
      }
    } finally {
      external?.removeEventListener('abort', abortHandler)
    }
  })()

  return {
    abort() {
      stopped = true
      controller.abort()
    },
    done
  }
}

async function parseFlexSse(reader: ReadableStreamDefaultReader<Uint8Array>, onEvent: (evt: FlexEventWithId) => void) {
  const decoder = new TextDecoder()
  let buffer = ''
  let eventType: string | undefined
  let eventId: string | undefined
  let dataLines: string[] = []

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    while (true) {
      const nl = buffer.indexOf('\n')
      if (nl === -1) break
      let line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      if (line.endsWith('\r')) line = line.slice(0, -1)

      if (line === '') {
        if (dataLines.length > 0) {
          const dataStr = dataLines.join('\n')
          let data: any
          try {
            data = JSON.parse(dataStr)
          } catch {
            data = { payload: dataStr }
          }
          const type = (data?.type as FlexEvent['type']) || (eventType as FlexEvent['type']) || 'log'
          const payload: FlexEventWithId = {
            type,
            id: eventId,
            timestamp: typeof data?.timestamp === 'string' ? data.timestamp : new Date().toISOString()
          }
          if (data?.payload !== undefined) payload.payload = data.payload
          if (typeof data?.message === 'string') payload.message = data.message
          if (typeof data?.runId === 'string') payload.runId = data.runId
          if (typeof data?.nodeId === 'string') payload.nodeId = data.nodeId
          if (typeof data?.correlationId === 'string') payload.correlationId = data.correlationId
          onEvent(payload)
        }
        eventType = undefined
        eventId = undefined
        dataLines = []
        continue
      }

      if (line.startsWith(':')) continue
      if (line.startsWith('event:')) eventType = line.slice(6).trim()
      else if (line.startsWith('id:')) eventId = line.slice(3).trim()
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
    }
  }
}
