import { AgentRuntime } from './agent-runtime'
import { registerHitlTools } from '../tools/hitl'
import { registerIOTools } from '../tools/io'
import { registerStrategyTools } from '../tools/strategy'
import { registerContentTools } from '../tools/content'
import { registerQaTools } from '../tools/qa'
import {
  getRuntimeCapabilityEntries,
  resolveRuntimeCapabilityPrompt,
  isLegacyMode,
  LEGACY_RUNTIME_CAPABILITIES
} from '../agents/runtime-capabilities'

let cachedRuntime: AgentRuntime | null = null

function createRuntime() {
  const runtime = new AgentRuntime()
  registerHitlTools(runtime)
  if (isLegacyMode()) {
    registerIOTools(runtime)
    registerStrategyTools(runtime)
    registerContentTools(runtime)
    registerQaTools(runtime)
  }
  return runtime
}

export function getRuntime(): AgentRuntime {
  if (!cachedRuntime) {
    cachedRuntime = createRuntime()
  }
  return cachedRuntime
}

export function getAgents() {
  return { runtime: getRuntime() }
}

export function getCapabilityRegistry() {
  return isLegacyMode() ? LEGACY_RUNTIME_CAPABILITIES : getRuntimeCapabilityEntries()
}

export function resolveCapabilityPrompt(capabilityId: string) {
  return resolveRuntimeCapabilityPrompt(capabilityId)
}
