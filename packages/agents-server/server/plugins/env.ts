import { config } from 'dotenv'
import { resolve } from 'node:path'

// Load package-local .env first
config()
// Then try project root .env (two levels up from packages/agents-server)
try {
  config({ path: resolve(process.cwd(), '../../.env') })
} catch {}

export default defineNitroPlugin(() => {
  // no-op; plugin exists to ensure dotenv loads early in Nitro runtime
})

