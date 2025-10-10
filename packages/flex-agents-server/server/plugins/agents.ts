import { AgentRuntime } from '../../src/services/agent-runtime'
import { StrategyManagerAgent } from '../../src/agents/strategy-manager'
import { ContentGeneratorAgent } from '../../src/agents/content-generator'
import { QualityAssuranceAgent } from '../../src/agents/quality-assurance'

export default defineNitroPlugin((nitro) => {
  const runtime = new AgentRuntime()
  const agents = {
    runtime,
    strategy: new StrategyManagerAgent(runtime),
    generator: new ContentGeneratorAgent(runtime),
    qa: new QualityAssuranceAgent(runtime)
  }
  nitro.hooks.hook('request', (event: any) => {
    // attach per-request for convenience
    event.context.agents = agents
  })
})
