export default defineEventHandler((event) => {
  return sendRedirect(event, '/api/v1/health', 307)
})
