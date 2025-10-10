export default defineEventHandler((event) => {
  const path = event.path || ''
  if (path.startsWith('/api/v1') && process.env.API_V1_DEPRECATION_START) {
    setHeader(event, 'Deprecation', 'true')
    if (process.env.API_V1_SUNSET) setHeader(event, 'Sunset', process.env.API_V1_SUNSET)
    setHeader(event, 'Link', '</docs/changelog#v1>; rel="deprecation"')
  }
})

