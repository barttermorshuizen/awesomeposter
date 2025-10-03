import discoverySseHandler from '../events/discovery.get'

export default defineEventHandler(async (event) => {
  console.warn('[discovery] /api/discovery/events.stream is deprecated, use /api/events/discovery instead.')
  return discoverySseHandler(event)
})
