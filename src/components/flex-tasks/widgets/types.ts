import type { FacetDefinition } from '@awesomeposter/shared'

export interface FacetWidgetProps {
  modelValue: unknown
  definition: FacetDefinition
  schema: Record<string, unknown>
  readonly?: boolean
  taskContext?: Record<string, unknown> | null
}

export type FacetWidgetEmits = {
  (e: 'update:modelValue', value: unknown): void
}

export type FeedbackSeverity = 'info' | 'minor' | 'major' | 'critical'

export type FeedbackResolution = 'open' | 'addressed' | 'dismissed'

export interface FeedbackEntryDisplay {
  facet: string
  path?: string | null
  message: string
  severity?: FeedbackSeverity
  timestamp?: string | null
  resolution?: FeedbackResolution | null
  author?: string | null
  note?: string | null
  sourceIndex?: number
}

export interface FeedbackComposerPayload {
  facet: string
  path?: string | null
  message: string
  severity: FeedbackSeverity
  timestamp: string
}
