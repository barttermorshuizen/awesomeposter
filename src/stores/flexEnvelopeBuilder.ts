import { defineStore } from 'pinia'
import {
  TaskEnvelopeSchema,
  type TaskEnvelope,
  type FlexEnvelopeConversationMessage,
  type FlexEnvelopeConversationDelta,
  type FlexEnvelopeConversationResponse
} from '@awesomeposter/shared'

type ConversationMessageRole = FlexEnvelopeConversationMessage['role']
type ConversationLogMessage = FlexEnvelopeConversationMessage & { error?: boolean }

type StartConversationOptions = {
  baseUrl: string
  authToken?: string
  envelope?: TaskEnvelope | null
}

type SendConversationOptions = {
  baseUrl: string
  authToken?: string
  envelope?: TaskEnvelope | null
  message: string
}

function generateId(): string {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
}

function nowIso(): string {
  return new Date().toISOString()
}

function cloneEnvelope(envelope: TaskEnvelope): TaskEnvelope {
  return JSON.parse(JSON.stringify(envelope)) as TaskEnvelope
}

function buildRequestInit(body: unknown, token?: string): RequestInit {
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/json'
  }
  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  return {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  }
}

export const useFlexEnvelopeBuilderStore = defineStore('flexEnvelopeBuilder', {
  state: () => ({
    conversationId: null as string | null,
    messages: [] as ConversationLogMessage[],
    pending: false,
    error: null as string | null,
    lastDeltaSummary: [] as string[],
    lastMissingFields: [] as string[],
    lastWarnings: [] as string[],
    lastEnvelopeSnapshot: null as TaskEnvelope | null
  }),
  getters: {
    hasConversation(state): boolean {
      return Boolean(state.conversationId)
    },
    canUndo(state): boolean {
      return Boolean(state.lastEnvelopeSnapshot)
    }
  },
  actions: {
    reset() {
      this.conversationId = null
      this.messages = []
      this.pending = false
      this.error = null
      this.lastDeltaSummary = []
      this.lastMissingFields = []
      this.lastWarnings = []
      this.lastEnvelopeSnapshot = null
    },
    appendSystemMessage(content: string) {
      this.messages.push({
        id: generateId(),
        role: 'system',
        content,
        timestamp: nowIso()
      })
    },
    appendUserMessage(content: string): ConversationLogMessage {
      const message: ConversationLogMessage = {
        id: generateId(),
        role: 'user',
        content,
        timestamp: nowIso()
      }
      this.messages.push(message)
      return message
    },
    appendServerMessages(messages: FlexEnvelopeConversationResponse['messages']) {
      if (!messages?.length) return
      for (const entry of messages) {
        const role: ConversationMessageRole =
          entry.role === 'assistant' || entry.role === 'system' ? entry.role : 'assistant'
        const entryMessage: ConversationLogMessage = {
          id: entry.id ?? generateId(),
          role,
          content: entry.content,
          timestamp: entry.timestamp ?? nowIso()
        }
        this.messages.push(entryMessage)
      }
    },
    applyDelta(delta: FlexEnvelopeConversationDelta | null, snapshot?: TaskEnvelope | null) {
      if (!delta) {
        this.lastDeltaSummary = []
        this.lastMissingFields = []
        this.lastWarnings = []
        return
      }
      this.lastDeltaSummary = delta.summary ?? []
      this.lastMissingFields = delta.missingFields ?? []
      this.lastWarnings = delta.warnings ?? []
      this.lastEnvelopeSnapshot = snapshot ?? null
    },
    acknowledgeEnvelopeValidity() {
      this.lastMissingFields = []
    },
    async startConversation(options: StartConversationOptions): Promise<TaskEnvelope | null> {
      this.reset()
      this.pending = true
      this.error = null
      try {
        const response = await fetch(
          `${options.baseUrl}/api/v1/flex/sandbox/envelope/conversation/start`,
          buildRequestInit(
            {
              envelope: options.envelope ?? null
            },
            options.authToken
          )
        )
        if (!response.ok) {
          throw new Error(`Failed to start conversation (${response.status})`)
        }
        const payload = (await response.json()) as FlexEnvelopeConversationResponse
        this.conversationId = payload.conversationId
        this.appendServerMessages(payload.messages)
        if (payload.delta?.envelope) {
          const parsed = TaskEnvelopeSchema.parse(payload.delta.envelope)
          this.applyDelta(
            {
              envelope: parsed,
              summary: payload.delta.summary ?? [],
              missingFields: payload.delta.missingFields ?? [],
              warnings: payload.delta.warnings ?? []
            },
            options.envelope ? cloneEnvelope(options.envelope) : null
          )
          return parsed
        }
        this.applyDelta(null)
        return null
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to start conversation'
        this.error = message
        throw new Error(message)
      } finally {
        this.pending = false
      }
    },
    async sendOperatorResponse(options: SendConversationOptions): Promise<FlexEnvelopeConversationDelta | null> {
      if (!this.conversationId) {
        throw new Error('Conversation has not been started yet.')
      }
      const snapshot = options.envelope ? cloneEnvelope(options.envelope) : null
      const userMessage = this.appendUserMessage(options.message)
      this.pending = true
      this.error = null
      const previousSnapshot = this.lastEnvelopeSnapshot ? cloneEnvelope(this.lastEnvelopeSnapshot) : null
      try {
        const response = await fetch(
          `${options.baseUrl}/api/v1/flex/sandbox/envelope/conversation/${encodeURIComponent(this.conversationId)}/respond`,
          buildRequestInit(
            {
              message: options.message,
              envelope: options.envelope ?? null
            },
            options.authToken
          )
        )
        if (!response.ok) {
          throw new Error(`Conversation request failed (${response.status})`)
        }
        const payload = (await response.json()) as FlexEnvelopeConversationResponse
        if (payload.conversationId) {
          this.conversationId = payload.conversationId
        }
        this.appendServerMessages(payload.messages)
        if (payload.delta?.envelope) {
          const parsed = TaskEnvelopeSchema.parse(payload.delta.envelope)
          const delta: FlexEnvelopeConversationDelta = {
            envelope: parsed,
            summary: payload.delta.summary ?? [],
            missingFields: payload.delta.missingFields ?? [],
            warnings: payload.delta.warnings ?? []
          }
          this.applyDelta(delta, snapshot)
          return delta
        }
        this.applyDelta(null, previousSnapshot)
        return null
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Conversation request failed'
        this.error = message
        userMessage.error = true
        this.lastEnvelopeSnapshot = previousSnapshot
        throw new Error(message)
      } finally {
        this.pending = false
      }
    },
    undoLastDelta(): TaskEnvelope | null {
      if (!this.lastEnvelopeSnapshot) return null
      const snapshot = cloneEnvelope(this.lastEnvelopeSnapshot)
      this.lastEnvelopeSnapshot = null
      this.lastDeltaSummary = []
      this.lastMissingFields = []
      this.lastWarnings = []
      this.appendSystemMessage('Reverted the last assistant update.')
      return snapshot
    }
  }
})
