import { AgentRuntime } from './agent-runtime'
import { StrategyManagerAgent } from '../agents/strategy-manager'
import { ContentGeneratorAgent } from '../agents/content-generator'
import { QualityAssuranceAgent } from '../agents/quality-assurance'
import { registerIOTools } from '../tools/io'
import { registerStrategyTools } from '../tools/strategy'
import { registerContentTools } from '../tools/content'
import { registerQaTools } from '../tools/qa'
import { registerHitlTools } from '../tools/hitl'
import { createStrategyAgent } from '../agents/strategy-manager'
import { createContentAgent } from '../agents/content-generator'
import { createQaAgent } from '../agents/quality-assurance'

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
  // Register core IO tools on first initialization
  registerIOTools(runtime)
  registerHitlTools(runtime)
  registerStrategyTools(runtime)
  registerContentTools(runtime)
  registerQaTools(runtime)
  cached = {
    runtime,
    strategy: new StrategyManagerAgent(runtime),
    generator: new ContentGeneratorAgent(runtime),
    qa: new QualityAssuranceAgent(runtime)
  }
  return cached
}

// Capability-driven registry (app-level)
export type CapabilityId = 'strategy' | 'generation' | 'qa'
export type CapabilityEntry = {
  id: CapabilityId
  name: string
  description: string
  create: typeof createStrategyAgent | typeof createContentAgent | typeof createQaAgent
}

export function getCapabilityRegistry(): CapabilityEntry[] {
  return [
    {
      id: 'strategy',
      name: 'Strategy Manager',
      description: 'Plans rationale and writer brief using client profile and assets.',
      create: createStrategyAgent
    },
    {
      id: 'generation',
      name: 'Content Generator',
      description: 'Generates or revises content drafts from a writer brief.',
      create: createContentAgent
    },
    {
      id: 'qa',
      name: 'Quality Assurance',
      description: 'Evaluates drafts for readability, clarity, fit, and compliance.',
      create: createQaAgent
    }
  ]
}
