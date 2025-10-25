import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { TaskEnvelope } from '@awesomeposter/shared'

const defaultEnvelope: TaskEnvelope = {
  objective: 'Draft objective goes here',
  inputs: {
    planKnobs: {
      formatType: 'text',
      variantCount: 1
    }
  },
  policies: {
    planner: {
      directives: {
        disallowStages: []
      }
    },
    runtime: []
  },
  specialInstructions: [],
  outputContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      additionalProperties: true
    }
  }
}

function mockOpenAI(createImpl: ReturnType<typeof vi.fn>) {
  vi.doMock('openai', () => ({
    OpenAI: class {
      chat = {
        completions: {
          create: createImpl
        }
      }
    }
  }))
}

describe('flex sandbox conversation service', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    process.env.FLEX_OPENAI_API_KEY = 'test-key'
    delete process.env.FLEX_OPENAI_DEFAULT_MODEL
    delete process.env.OPENAI_DEFAULT_MODEL
    delete process.env.OPENAI_MODEL
  })

  afterEach(() => {
    vi.doUnmock('openai')
  })

  it('starts a conversation using the gpt-5 fallback model', async () => {
    const createMock = vi.fn().mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              reply: 'What objective should we pursue first?',
              patches: [],
              summary: ['Initialized envelope draft.'],
              missingFields: ['objective'],
              warnings: []
            })
          }
        }
      ]
    })

    mockOpenAI(createMock)
    const { beginSandboxConversation } = await import('../src/services/flex-sandbox-conversation')

    const result = await beginSandboxConversation(null)
    expect(result.conversationId).toBeTruthy()
    expect(result.messages).toHaveLength(1)
    expect(result.messages[0].content).toContain('objective')
    expect(result.delta?.missingFields).toContain('objective')
    expect(createMock).toHaveBeenCalledTimes(1)
    const args = createMock.mock.calls[0]?.[0]
    expect(args?.model).toBe('gpt-5')
  })

  it('respects FLEX_OPENAI_DEFAULT_MODEL when continuing a session', async () => {
    process.env.FLEX_OPENAI_DEFAULT_MODEL = 'gpt-5.1-mini'
    const responses = [
      {
        reply: 'Tell me about the objective for this envelope.',
        patches: [],
        summary: ['Initialized envelope draft.'],
        missingFields: ['objective'],
        warnings: []
      },
      {
        reply: 'Objective captured. Anything else we should tweak?',
        patches: [
          { op: 'replace', path: '/objective', value: 'Launch the Spring poster campaign' }
        ],
        summary: ['Objective updated.'],
        missingFields: [],
        warnings: []
      }
    ]

    const createMock = vi.fn()
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(responses[0]) } }] })
    createMock.mockResolvedValueOnce({ choices: [{ message: { content: JSON.stringify(responses[1]) } }] })

    mockOpenAI(createMock)
    const { beginSandboxConversation, continueSandboxConversation } = await import('../src/services/flex-sandbox-conversation')

    const start = await beginSandboxConversation(null)
    expect(start.delta?.missingFields).toContain('objective')

    const updatedEnvelope = {
      ...start.delta?.envelope,
      objective: 'Launch the Spring poster campaign'
    } as TaskEnvelope

    const followUp = await continueSandboxConversation(
      start.conversationId,
      'We need to launch the Spring poster campaign.',
      updatedEnvelope
    )

    expect(createMock).toHaveBeenCalledTimes(2)
    expect(createMock.mock.calls.every((call) => call[0]?.model === 'gpt-5.1-mini')).toBe(true)
    expect(followUp.delta?.envelope.objective).toBe('Launch the Spring poster campaign')
    expect(followUp.delta?.summary).toContain('Objective updated.')
  })

  it('throws when the conversation id does not exist', async () => {
    const { continueSandboxConversation } = await import('../src/services/flex-sandbox-conversation')
    await expect(continueSandboxConversation('missing', 'Hello', null)).rejects.toMatchObject({ statusCode: 404 })
  })
})
