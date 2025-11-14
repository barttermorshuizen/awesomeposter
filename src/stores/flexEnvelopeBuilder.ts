import { defineStore } from 'pinia'
import {
  TaskEnvelopeSchema,
  type TaskEnvelope,
  type FlexEnvelopeConversationMessage,
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

function cloneEnvelope<T extends object>(envelope: T): T {
  return JSON.parse(JSON.stringify(envelope ?? null)) as T
}

type EnvelopeSnapshot = Record<string, unknown>

type FlexEnvelopeBuilderState = {
  conversationId: string | null
  messages: ConversationLogMessage[]
  pending: boolean
  error: string | null
  lastDeltaSummary: string[]
  lastMissingFields: string[]
  lastWarnings: string[]
  lastEnvelopeSnapshot: EnvelopeSnapshot | null
}

type EnvelopeDeltaPayload = {
  summary?: string[]
  missingFields?: string[]
  warnings?: string[]
  envelope?: TaskEnvelope | null
}

function cloneSnapshot(value: TaskEnvelope | EnvelopeSnapshot | null | undefined): EnvelopeSnapshot | null {
  if (!value) return null
  return cloneEnvelope(value) as EnvelopeSnapshot
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
  state: (): FlexEnvelopeBuilderState => ({
    conversationId: null,
    messages: [],
    pending: false,
    error: null,
    lastDeltaSummary: [],
    lastMissingFields: [],
    lastWarnings: [],
    lastEnvelopeSnapshot: null
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
    appendServerMessages(messages?: FlexEnvelopeConversationMessage[] | null) {
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
    applyDelta(delta: EnvelopeDeltaPayload | null, snapshot?: EnvelopeSnapshot | null) {
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
            cloneSnapshot(options.envelope)
          )
          return parsed
        }
        this.applyDelta(
          payload.delta
            ? {
                summary: payload.delta.summary ?? [],
                missingFields: payload.delta.missingFields ?? [],
                warnings: payload.delta.warnings ?? []
              }
            : null,
          cloneSnapshot(options.envelope)
        )
        return null
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Failed to start conversation'
        this.error = message
        throw new Error(message)
      } finally {
        this.pending = false
      }
    },
    async sendOperatorResponse(options: SendConversationOptions): Promise<EnvelopeDeltaPayload | null> {
      if (!this.conversationId) {
        throw new Error('Conversation has not been started yet.')
      }
      const snapshot = cloneSnapshot(options.envelope)
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
          const delta: EnvelopeDeltaPayload = {
            envelope: parsed,
            summary: payload.delta.summary ?? [],
            missingFields: payload.delta.missingFields ?? [],
            warnings: payload.delta.warnings ?? []
          }
          this.applyDelta(delta, snapshot)
          return delta
        }
        const summaryOnly = payload.delta
          ? {
              summary: payload.delta.summary ?? [],
              missingFields: payload.delta.missingFields ?? [],
              warnings: payload.delta.warnings ?? []
            }
          : null
        this.applyDelta(summaryOnly, previousSnapshot)
        return summaryOnly
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
      return snapshot as TaskEnvelope
    }
  }
})
