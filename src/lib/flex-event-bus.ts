import type { FlexEventWithId } from '@/lib/flex-sse'

const EVENT_NAME = 'flex-event'

export function emitFlexEvent(event: FlexEventWithId) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<FlexEventWithId>(EVENT_NAME, { detail: event }))
}

export function addFlexEventListener(listener: (event: FlexEventWithId) => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = (evt: Event) => {
    if (!(evt instanceof CustomEvent)) return
    listener(evt.detail as FlexEventWithId)
  }
  window.addEventListener(EVENT_NAME, handler)
  return () => window.removeEventListener(EVENT_NAME, handler)
}
