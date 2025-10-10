export default defineNitroPlugin(() => {
  // Enforce critical env in production so auth middleware can always validate
  if (process.env.NODE_ENV === 'production') {
    const missing: string[] = []
    if (!process.env.FLEX_API_KEY && !process.env.API_KEY) missing.push('FLEX_API_KEY')
    if (!process.env.FLEX_OPENAI_API_KEY && !process.env.OPENAI_API_KEY) missing.push('FLEX_OPENAI_API_KEY')

    if (missing.length > 0) {
      // Throwing during plugin init will prevent the server from starting
      throw new Error(`[flex-agents-server] Missing required environment variables in production: ${missing.join(', ')}`)
    }
  }
})
