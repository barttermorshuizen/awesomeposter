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
