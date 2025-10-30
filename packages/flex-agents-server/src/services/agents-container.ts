import { AgentRuntime } from './agent-runtime'
import { registerHitlTools } from '../tools/hitl'
import { resolveRuntimeCapabilityPrompt } from '../agents/runtime-capabilities'

let cachedRuntime: AgentRuntime | null = null

function createRuntime() {
  const runtime = new AgentRuntime()
  registerHitlTools(runtime)
  return runtime
}

export function getRuntime(): AgentRuntime {
  if (!cachedRuntime) {
    cachedRuntime = createRuntime()
  }
  return cachedRuntime
}

export function resolveCapabilityPrompt(capabilityId: string) {
  return resolveRuntimeCapabilityPrompt(capabilityId)
}
