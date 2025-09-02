import { AgentRuntime } from './agent-runtime'
import { StrategyManagerAgent } from '../agents/strategy-manager'
import { ContentGeneratorAgent } from '../agents/content-generator'
import { QualityAssuranceAgent } from '../agents/quality-assurance'

type Agents = {
  runtime: AgentRuntime
  strategy: StrategyManagerAgent
  generator: ContentGeneratorAgent
  qa: QualityAssuranceAgent
}

let cached: Agents | null = null

export function getAgents(): Agents {
  if (cached) return cached
  const runtime = new AgentRuntime()
  cached = {
    runtime,
    strategy: new StrategyManagerAgent(runtime),
    generator: new ContentGeneratorAgent(runtime),
    qa: new QualityAssuranceAgent(runtime)
  }
  return cached
}

