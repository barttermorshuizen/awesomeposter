#!/usr/bin/env node
import process from 'node:process'
import { config as loadEnv } from 'dotenv'
import { createRequire } from 'node:module'
import readline from 'node:readline/promises'
import { stdin as input, stdout as output } from 'node:process'

loadEnv()

const require = createRequire(import.meta.url)
const jiti = require('jiti')(import.meta.url)

const {
  getDb,
  clients,
  clientFeatures,
  eq,
  and,
} = jiti('../packages/db/src/index.ts')

const {
  FEATURE_DISCOVERY_AGENT,
  DISCOVERY_FLAG_CHANGED_EVENT,
} = jiti('../packages/shared/src/feature-flags.ts')

const {
  setDiscoveryFlag,
} = jiti('../server/utils/client-config/feature-flag-admin.ts')

const PILOT_RUNBOOK_URL = 'https://github.com/AwesomePoster/awesomeposter/blob/main/docs/prd/epic-discovery-feature-flag-pilot/pilot-onboarding-runbook.md'

function printUsage() {
  console.log(`Usage:
  pnpm run flags -- list
  pnpm run flags -- toggle --client <uuid> (--enable | --disable) --actor <email|id> [--reason <text>]

Options:
  --actor       Required when toggling. Identifier recorded in audit log.
  --reason      Optional context for the change. Stored alongside audit record.
  --yes, -y     Skip interactive confirmation when toggling.
  --json        Output machine-readable JSON for list command.

Docs: ${PILOT_RUNBOOK_URL}
`)
}

function parseArgs(rawArgs) {
  const args = [...rawArgs]
  while (args.length > 0 && args[0] === '--') {
    args.shift()
  }

  if (args.length === 0) {
    return { command: 'help' }
  }
  const [command, ...rest] = args
  switch (command) {
    case 'list':
      return parseListArgs(rest)
    case 'toggle':
      return parseToggleArgs(rest)
    case '--help':
    case '-h':
      return { command: 'help' }
    default:
      return { command: 'unknown', value: command }
  }
}

function parseListArgs(args) {
  const options = { json: false }
  for (const arg of args) {
    if (arg === '--json') {
      options.json = true
    } else {
      throw new Error(`Unknown option for list command: ${arg}`)
    }
  }
  return { command: 'list', options }
}

function parseToggleArgs(args) {
  const options = {
    clientId: null,
    enable: null,
    actor: null,
    reason: null,
    skipConfirm: false,
  }
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '--client') {
      options.clientId = args[++i]
    } else if (arg === '--enable') {
      options.enable = true
    } else if (arg === '--disable') {
      options.enable = false
    } else if (arg === '--actor') {
      options.actor = args[++i]
    } else if (arg === '--reason') {
      options.reason = args[++i]
    } else if (arg === '--yes' || arg === '-y') {
      options.skipConfirm = true
    } else if (arg === '--help' || arg === '-h') {
      return { command: 'help' }
    } else {
      throw new Error(`Unknown option for toggle command: ${arg}`)
    }
  }

  if (!options.clientId) {
    throw new Error('Missing required option: --client <uuid>')
  }
  if (options.enable === null) {
    throw new Error('Missing required option: specify either --enable or --disable')
  }
  if (!options.actor) {
    throw new Error('Missing required option: --actor <identifier>')
  }

  return { command: 'toggle', options }
}

async function listFlags({ json }) {
  const db = getDb()
  const clientsResult = await db
    .select({
      id: clients.id,
      name: clients.name,
      slug: clients.slug,
    })
    .from(clients)
    .orderBy(clients.name)

  const featureRows = await db
    .select({
      clientId: clientFeatures.clientId,
      enabled: clientFeatures.enabled,
    })
    .from(clientFeatures)
    .where(eq(clientFeatures.feature, FEATURE_DISCOVERY_AGENT))

  const featureMap = new Map(featureRows.map((row) => [row.clientId, row.enabled]))

  const data = clientsResult.map((client) => ({
    id: client.id,
    name: client.name,
    slug: client.slug,
    discoveryEnabled: featureMap.get(client.id) ?? false,
  }))

  if (json) {
    console.log(JSON.stringify({ ok: true, data }, null, 2))
    return
  }

  console.log('\nDiscovery agent feature flag status by client:\n')
  for (const record of data) {
    const status = record.discoveryEnabled ? 'enabled ' : 'disabled'
    console.log(`• ${record.name} (${record.slug ?? 'no-slug'}) :: ${status}`)
  }
  console.log('\nTotal clients:', data.length)
}

async function toggleFlag({ clientId, enable, actor, reason, skipConfirm }) {
  const db = getDb()
  const [client] = await db
    .select({ id: clients.id, name: clients.name, slug: clients.slug })
    .from(clients)
    .where(eq(clients.id, clientId))
    .limit(1)

  if (!client) {
    throw new Error(`Client ${clientId} not found`)
  }

  const [featureRecord] = await db
    .select({ enabled: clientFeatures.enabled })
    .from(clientFeatures)
    .where(and(eq(clientFeatures.clientId, clientId), eq(clientFeatures.feature, FEATURE_DISCOVERY_AGENT)))
    .limit(1)

  const previousEnabledSnapshot = featureRecord?.enabled ?? false

  if (previousEnabledSnapshot === enable) {
    console.log(`No change: discovery agent already ${previousEnabledSnapshot ? 'enabled' : 'disabled'} for client ${client.name}.`)
    return
  }

  if (!skipConfirm) {
    const rl = readline.createInterface({ input, output })
    const answer = await rl.question(`Toggle discovery agent for ${client.name} (${client.id}) to ${enable ? 'ENABLED' : 'DISABLED'}? (y/N) `)
    rl.close()
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.log('Aborted by user.')
      return
    }
  }

  const result = await setDiscoveryFlag({
    clientId,
    enable,
    actor,
    reason: reason ?? null,
  })

  if (!result.changed) {
    console.log('No update performed: flag state changed during confirmation window or already matched desired state.')
    return
  }

  console.log(`Updated discovery agent flag for ${client.name} (${client.id}).`)
  console.log(`Previous state: ${result.previousEnabled ? 'enabled' : 'disabled'} → New state: ${result.newEnabled ? 'ENABLED' : 'DISABLED'}`)
  console.log(`Day-1 checklist & telemetry steps: ${PILOT_RUNBOOK_URL}`)

  const telemetryPayload = {
    event: DISCOVERY_FLAG_CHANGED_EVENT,
    clientId,
    feature: FEATURE_DISCOVERY_AGENT,
    enabled: result.newEnabled,
    previousEnabled: result.previousEnabled,
    actor,
    reason: reason ?? null,
    occurredAt: result.occurredAt.toISOString(),
  }

  console.log('Telemetry:', JSON.stringify(telemetryPayload))
  console.log('Telemetry: discovery.flagChanged event emitted.')
  console.log('Propagation: published feature.flags.updated event for downstream cache invalidation.')
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2))

    if (parsed.command === 'help') {
      printUsage()
      return
    }

    if (parsed.command === 'unknown') {
      console.error(`Unknown command: ${parsed.value}`)
      printUsage()
      process.exit(1)
    }

    if (parsed.command === 'list') {
      await listFlags(parsed.options)
      return
    }

    if (parsed.command === 'toggle') {
      await toggleFlag(parsed.options)
      return
    }

    printUsage()
  } catch (error) {
    console.error('Error:', error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

await main()
