export default defineNitroPlugin(() => {
  // Enforce critical env in production so auth middleware can always validate
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = []
    if (!process.env.API_KEY) missing.push('API_KEY')
    if (!process.env.OPENAI_API_KEY) missing.push('OPENAI_API_KEY')

    if (missing.length > 0) {
      // Throwing during plugin init will prevent the server from starting
      throw new Error(`[agents-server] Missing required environment variables in production: ${missing.join(', ')}`)
    }
  }
})