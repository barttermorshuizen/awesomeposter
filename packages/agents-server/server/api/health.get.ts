export default defineEventHandler(() => ({
  status: 'healthy',
  timestamp: new Date().toISOString()
}))

