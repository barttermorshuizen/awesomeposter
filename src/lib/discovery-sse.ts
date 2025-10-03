import type {
  DiscoveryKeywordUpdatedEvent,
  DiscoverySourceCreatedEvent,
  DiscoveryTelemetryEvent,
} from '@awesomeposter/shared'
import { discoveryTelemetryEventSchema } from '@awesomeposter/shared'

export type DiscoveryEventHandlers = {
  onSourceCreated?: (payload: DiscoverySourceCreatedEvent['payload']) => void
  onKeywordUpdated?: (payload: DiscoveryKeywordUpdatedEvent['payload']) => void
  onEvent?: (event: DiscoveryTelemetryEvent) => void
  onFeatureDisabled?: (payload: DiscoveryFeatureDisabledPayload) => void
}

export type DiscoveryFeatureDisabledPayload = {
  reason?: string
  message?: string
  [key: string]: unknown
}

type StreamState = {
  source: EventSource | null
  handlers: Set<DiscoveryEventHandlers>
  reconnectHandle: ReturnType<typeof setTimeout> | null
  messageHandler?: (event: MessageEvent<string>) => void
  errorHandler?: () => void
  featureDisabledHandler?: (event: MessageEvent<string>) => void
}

const streams = new Map<string, StreamState>()

function ensureEnvironment() {
  return typeof window !== 'undefined' && typeof window.EventSource !== 'undefined'
}

function cleanupStream(clientId: string, state: StreamState) {
  if (state.reconnectHandle) {
    clearTimeout(state.reconnectHandle)
    state.reconnectHandle = null
  }
  if (state.source) {
    if (state.messageHandler) {
      state.source.removeEventListener('message', state.messageHandler)
    }
    if (state.errorHandler) {
      state.source.removeEventListener('error', state.errorHandler)
    }
    if (state.featureDisabledHandler) {
      state.source.removeEventListener('feature_disabled', state.featureDisabledHandler as EventListener)
    }
    state.source.close()
    state.source = null
    state.messageHandler = undefined
    state.errorHandler = undefined
    state.featureDisabledHandler = undefined
  }
  if (state.handlers.size === 0) {
    streams.delete(clientId)
  }
}

const RECONNECT_DELAY_MS = 5_000

function connectStream(clientId: string, state: StreamState) {
  if (!ensureEnvironment()) return
  const url = new URL('/api/events/discovery', window.location.origin)
  url.searchParams.set('clientId', clientId)

  const source = new EventSource(url.toString(), { withCredentials: true })
  state.source = source

  const messageHandler = (event: MessageEvent<string>) => {
    try {
      const parsed = JSON.parse(event.data)
      const validation = discoveryTelemetryEventSchema.safeParse(parsed)
      if (!validation.success) {
        console.error('Invalid discovery event payload', validation.error)
        return
      }

      const envelope = validation.data
      state.handlers.forEach((handler) => {
        handler.onEvent?.(envelope)
        if (envelope.eventType === 'source-created') {
          handler.onSourceCreated?.(envelope.payload)
        } else if (envelope.eventType === 'keyword.updated') {
          handler.onKeywordUpdated?.(envelope.payload)
        }
      })
    } catch (err) {
      console.error('Failed to parse discovery SSE payload', err)
    }
  }

  const errorHandler = () => {
    cleanupStream(clientId, state)
    state.reconnectHandle = setTimeout(() => {
      connectStream(clientId, state)
    }, RECONNECT_DELAY_MS)
  }

  const featureDisabledHandler = (event: MessageEvent<string>) => {
    let payload: DiscoveryFeatureDisabledPayload = {}
    if (event.data) {
      try {
        const parsed = JSON.parse(event.data)
        if (parsed && typeof parsed === 'object') {
          payload = parsed as DiscoveryFeatureDisabledPayload
        }
      } catch {
        payload = { message: event.data }
      }
    }

    state.handlers.forEach((handler) => {
      handler.onFeatureDisabled?.(payload)
    })

    cleanupStream(clientId, state)
  }

  source.addEventListener('message', messageHandler)
  source.addEventListener('error', errorHandler)
  source.addEventListener('feature_disabled', featureDisabledHandler as EventListener)
  state.messageHandler = messageHandler
  state.errorHandler = errorHandler
  state.featureDisabledHandler = featureDisabledHandler
}

export function subscribeToDiscoveryEvents(clientId: string, handler: DiscoveryEventHandlers) {
  if (!clientId || !ensureEnvironment()) {
    return () => {}
  }

  let state = streams.get(clientId)
  if (!state) {
    state = {
      source: null,
      handlers: new Set(),
      reconnectHandle: null,
    }
    streams.set(clientId, state)
  }

  state.handlers.add(handler)
  if (!state.source) {
    connectStream(clientId, state)
  }

  return () => {
    const current = streams.get(clientId)
    if (!current) return
    current.handlers.delete(handler)
    if (current.handlers.size === 0) {
      cleanupStream(clientId, current)
    }
  }
}

export function __resetDiscoveryEventStreamsForTests() {
  streams.forEach((state, clientId) => cleanupStream(clientId, state))
  streams.clear()
}
