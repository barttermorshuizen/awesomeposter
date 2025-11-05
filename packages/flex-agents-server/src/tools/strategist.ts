import { z } from 'zod'
import { AgentRuntime } from '../services/agent-runtime'
import { StrategistRetrievalService } from '../services/strategist-retrieval-service'
import { STRATEGIST_SOCIAL_POSTING_ID } from '../agents/marketing/strategist-social-posting'

export const STRATEGIST_KNOWLEDGE_TOOL_NAME = 'strategist_retrieve_knowledge' as const

const retrievalService = new StrategistRetrievalService()

const parametersSchema = z.object({
  query: z.string().min(1, 'Query must not be empty.')
})

export function registerStrategistTools(runtime: AgentRuntime) {
  runtime.registerTool({
    name: STRATEGIST_KNOWLEDGE_TOOL_NAME,
    description:
      'Retrieve curated strategist knowledge snippets from the vector store. Provide a focused query that describes the campaign objective, channel, or topic you need guidance on.',
    parameters: parametersSchema,
    handler: async (args) => {
      const { query } = parametersSchema.parse(args)
      return retrievalService.retrieveFromQuery(query, {
        capabilityId: STRATEGIST_SOCIAL_POSTING_ID
      })
    }
  })
}
