import { config } from 'dotenv'
import { resolve } from 'node:path'

function loadEnvDir(dir: string) {
  config({ path: resolve(dir, '.env'), override: false })
  config({ path: resolve(dir, '.env.local'), override: true })
}

// Load package-local env first so repo-level overrides can win.
loadEnvDir(process.cwd())
loadEnvDir(resolve(process.cwd(), '..', '..'))

export default defineNitroPlugin(() => {
  // no-op; plugin exists to ensure dotenv loads early in Nitro runtime
})
