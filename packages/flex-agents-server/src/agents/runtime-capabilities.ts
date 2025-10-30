import type { CapabilityRegistration } from '@awesomeposter/shared'
import { AgentRuntime } from '../services/agent-runtime'
import {
  STRATEGIST_SOCIAL_POSTING_CAPABILITY,
  STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_APP,
  STRATEGIST_SOCIAL_POSTING_TOOLS,
  createStrategistSocialPostingAgent
} from './marketing/strategist-social-posting'
import {
  STRATEGIST_POSITIONING_CAPABILITY,
  STRATEGIST_POSITIONING_INSTRUCTIONS_APP,
  STRATEGIST_POSITIONING_TOOLS,
  createStrategistPositioningAgent
} from './marketing/strategist-positioning'
import {
  COPYWRITER_SOCIAL_DRAFTING_CAPABILITY,
  COPYWRITER_SOCIAL_DRAFTING_INSTRUCTIONS_APP,
  COPYWRITER_SOCIAL_DRAFTING_TOOLS,
  createCopywriterSocialDraftingAgent
} from './marketing/copywriter-socialpost-drafting'
import {
  COPYWRITER_MESSAGING_CAPABILITY,
  COPYWRITER_MESSAGING_INSTRUCTIONS_APP,
  COPYWRITER_MESSAGING_TOOLS,
  createCopywriterMessagingAgent
} from './marketing/copywriter-messaging'
import { DESIGNER_VISUAL_DESIGN_CAPABILITY } from './marketing/designer-visual-design'
import { DIRECTOR_SOCIAL_REVIEW_CAPABILITY } from './marketing/director-social-review'
import { DIRECTOR_POSITIONING_REVIEW_CAPABILITY } from './marketing/director-positioning-review'
import { HUMAN_CLARIFY_CAPABILITY, HUMAN_CLARIFY_INSTRUCTIONS_APP } from '../agents/human-clarify-brief'

export type RuntimeCapabilityEntry = {
  capabilityId: string
  displayName: string
  agentType: 'ai' | 'human'
  registration: CapabilityRegistration
  instructions: string
  toolsAllowlist: string[]
  createAgent?: (
    runtime: AgentRuntime,
    onEvent?: (
      ev: { type: 'tool_call' | 'tool_result' | 'metrics'; name?: string; args?: any; result?: any; durationMs?: number; tokens?: number }
    ) => void,
    opts?: { policy?: 'auto' | 'required' | 'off'; requestAllowlist?: string[] },
    mode?: 'chat' | 'app'
  ) => any
}

const MARKETING_AI_ENTRIES: RuntimeCapabilityEntry[] = [
  {
    capabilityId: STRATEGIST_SOCIAL_POSTING_CAPABILITY.capabilityId,
    displayName: STRATEGIST_SOCIAL_POSTING_CAPABILITY.displayName,
    agentType: 'ai',
    registration: STRATEGIST_SOCIAL_POSTING_CAPABILITY,
    instructions: STRATEGIST_SOCIAL_POSTING_INSTRUCTIONS_APP,
    toolsAllowlist: [...STRATEGIST_SOCIAL_POSTING_TOOLS],
    createAgent: createStrategistSocialPostingAgent
  },
  {
    capabilityId: STRATEGIST_POSITIONING_CAPABILITY.capabilityId,
    displayName: STRATEGIST_POSITIONING_CAPABILITY.displayName,
    agentType: 'ai',
    registration: STRATEGIST_POSITIONING_CAPABILITY,
    instructions: STRATEGIST_POSITIONING_INSTRUCTIONS_APP,
    toolsAllowlist: [...STRATEGIST_POSITIONING_TOOLS],
    createAgent: createStrategistPositioningAgent
  },
  {
    capabilityId: COPYWRITER_SOCIAL_DRAFTING_CAPABILITY.capabilityId,
    displayName: COPYWRITER_SOCIAL_DRAFTING_CAPABILITY.displayName,
    agentType: 'ai',
    registration: COPYWRITER_SOCIAL_DRAFTING_CAPABILITY,
    instructions: COPYWRITER_SOCIAL_DRAFTING_INSTRUCTIONS_APP,
    toolsAllowlist: [...COPYWRITER_SOCIAL_DRAFTING_TOOLS],
    createAgent: createCopywriterSocialDraftingAgent
  },
  {
    capabilityId: COPYWRITER_MESSAGING_CAPABILITY.capabilityId,
    displayName: COPYWRITER_MESSAGING_CAPABILITY.displayName,
    agentType: 'ai',
    registration: COPYWRITER_MESSAGING_CAPABILITY,
    instructions: COPYWRITER_MESSAGING_INSTRUCTIONS_APP,
    toolsAllowlist: [...COPYWRITER_MESSAGING_TOOLS],
    createAgent: createCopywriterMessagingAgent
  }
]

const MARKETING_HUMAN_ENTRIES: RuntimeCapabilityEntry[] = [
  {
    capabilityId: DESIGNER_VISUAL_DESIGN_CAPABILITY.capabilityId,
    displayName: DESIGNER_VISUAL_DESIGN_CAPABILITY.displayName,
    agentType: 'human',
    registration: DESIGNER_VISUAL_DESIGN_CAPABILITY,
    instructions: DESIGNER_VISUAL_DESIGN_CAPABILITY.instructionTemplates?.app ?? '',
    toolsAllowlist: []
  },
  {
    capabilityId: DIRECTOR_SOCIAL_REVIEW_CAPABILITY.capabilityId,
    displayName: DIRECTOR_SOCIAL_REVIEW_CAPABILITY.displayName,
    agentType: 'human',
    registration: DIRECTOR_SOCIAL_REVIEW_CAPABILITY,
    instructions: DIRECTOR_SOCIAL_REVIEW_CAPABILITY.instructionTemplates?.app ?? '',
    toolsAllowlist: []
  },
  {
    capabilityId: DIRECTOR_POSITIONING_REVIEW_CAPABILITY.capabilityId,
    displayName: DIRECTOR_POSITIONING_REVIEW_CAPABILITY.displayName,
    agentType: 'human',
    registration: DIRECTOR_POSITIONING_REVIEW_CAPABILITY,
    instructions: DIRECTOR_POSITIONING_REVIEW_CAPABILITY.instructionTemplates?.app ?? '',
    toolsAllowlist: []
  },
  {
    capabilityId: HUMAN_CLARIFY_CAPABILITY.capabilityId,
    displayName: HUMAN_CLARIFY_CAPABILITY.displayName,
    agentType: 'human',
    registration: HUMAN_CLARIFY_CAPABILITY,
    instructions: HUMAN_CLARIFY_INSTRUCTIONS_APP,
    toolsAllowlist: []
  }
]

export const RUNTIME_CAPABILITIES: RuntimeCapabilityEntry[] = [...MARKETING_AI_ENTRIES, ...MARKETING_HUMAN_ENTRIES]

export function getRuntimeCapabilityEntries(): RuntimeCapabilityEntry[] {
  return RUNTIME_CAPABILITIES
}

export function getCapabilityRegistrationsForSelfRegister(): CapabilityRegistration[] {
  return getRuntimeCapabilityEntries().map((entry) => entry.registration)
}

export function resolveRuntimeCapabilityPrompt(capabilityId: string): { instructions: string; toolsAllowlist: string[] } | null {
  const entry = getRuntimeCapabilityEntries().find((candidate) => candidate.capabilityId === capabilityId)
  return entry ? { instructions: entry.instructions, toolsAllowlist: [...entry.toolsAllowlist] } : null
}
