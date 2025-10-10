import { computed, reactive, ref, watch } from 'vue'
import {
  DEFAULT_WEB_LIST_MAX_DEPTH,
  discoverySourceWebListConfigInputSchema,
  serializeDiscoverySourceConfig,
  type DiscoverySourceWebListConfig,
  type DiscoverySourceWebListSelector,
  type RegexValueTransform,
} from '@awesomeposter/shared'
import type { WebListSuggestionState } from '@/stores/discoverySources'

type SelectorFormState = {
  selector: string
  attribute: string
  valueTransformEnabled: boolean
  valueTransformPattern: string
  valueTransformFlags: string
  valueTransformReplacement: string
  legacyValueTemplate: string
  valueTransformWarnings: string[]
}

type FieldsFormState = {
  title: SelectorFormState
  url: SelectorFormState
  excerpt: SelectorFormState
  timestamp: SelectorFormState
}

type PaginationFormState = {
  enabled: boolean
  nextPageSelector: string
  maxDepth: number
}

export type WebListFormState = {
  enabled: boolean
  listContainerSelector: string
  itemSelector: string
  fields: FieldsFormState
  pagination: PaginationFormState
}

export type ValidationErrors = Record<string, string[]>

const createSelectorFormState = (selector?: DiscoverySourceWebListSelector | null): SelectorFormState => {
  const transform = selector?.valueTransform ?? null
  const warnings = Array.isArray(selector?.valueTransformWarnings)
    ? [...selector!.valueTransformWarnings!]
    : []
  return {
    selector: selector?.selector ?? '',
    attribute: selector?.attribute ?? '',
    valueTransformEnabled: Boolean(transform),
    valueTransformPattern: transform?.pattern ?? '',
    valueTransformFlags: transform?.flags ?? '',
    valueTransformReplacement: transform?.replacement ?? '',
    legacyValueTemplate: selector?.legacyValueTemplate ?? '',
    valueTransformWarnings: warnings,
  }
}

const createFieldsFormState = (config?: DiscoverySourceWebListConfig | null): FieldsFormState => ({
  title: createSelectorFormState(config?.fields?.title),
  url: createSelectorFormState(config?.fields?.url),
  excerpt: createSelectorFormState(config?.fields?.excerpt),
  timestamp: createSelectorFormState(config?.fields?.timestamp),
})

const createPaginationFormState = (config?: DiscoverySourceWebListConfig | null): PaginationFormState => ({
  enabled: Boolean(config?.pagination),
  nextPageSelector: config?.pagination?.nextPage.selector ?? '',
  maxDepth: config?.pagination?.maxDepth ?? DEFAULT_WEB_LIST_MAX_DEPTH,
})

const trimOrNull = (value: string) => {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

const buildValueTransform = (state: SelectorFormState): RegexValueTransform | null => {
  if (!state.valueTransformEnabled) {
    return null
  }
  const rawPattern = state.valueTransformPattern
  const trimmedPattern = rawPattern.trim()
  const patternToUse = trimmedPattern.length ? trimmedPattern : rawPattern
  const transform: RegexValueTransform = { pattern: patternToUse }
  const trimmedFlags = state.valueTransformFlags.trim()
  if (trimmedFlags) {
    transform.flags = trimmedFlags
  }
  if (state.valueTransformReplacement.length > 0) {
    transform.replacement = state.valueTransformReplacement
  }
  return transform
}

const toSelectorConfig = (state: SelectorFormState): DiscoverySourceWebListSelector | null => {
  const selector = trimOrNull(state.selector)
  if (!selector) {
    return null
  }
  const attribute = trimOrNull(state.attribute)
  const valueTransform = buildValueTransform(state)
  const payload: DiscoverySourceWebListSelector = {
    selector,
  }
  if (attribute) {
    payload.attribute = attribute
  }
  if (valueTransform) {
    payload.valueTransform = valueTransform
  }
  if (state.legacyValueTemplate) {
    payload.legacyValueTemplate = state.legacyValueTemplate
  }
  if (state.valueTransformWarnings.length) {
    payload.valueTransformWarnings = [...state.valueTransformWarnings]
  }
  return payload
}

const mapIssuePath = (path: (string | number)[]): string => {
  if (!path.length) return 'form'
  const [first, ...rest] = path
  switch (first) {
    case 'list_container_selector':
      return 'listContainerSelector'
    case 'item_selector':
      return 'itemSelector'
    case 'fields': {
      if (!rest.length) return 'fields'
      const [field, ...fieldRest] = rest
      if (typeof field !== 'string') return `fields.${String(field)}`
      if (!fieldRest.length) {
        return `fields.${field}`
      }
      return `fields.${field}.${fieldRest.map(String).join('.')}`
    }
    case 'pagination': {
      if (!rest.length) return 'pagination'
      const [key, ...restKeys] = rest
      if (key === 'next_page') {
        if (!restKeys.length) {
          return 'pagination.nextPage'
        }
        return `pagination.nextPage.${restKeys.map(String).join('.')}`
      }
      if (key === 'max_depth') {
        return 'pagination.maxDepth'
      }
      return `pagination.${String(key)}`
    }
    default:
      return [first, ...rest].map(String).join('.')
  }
}

const buildWebListConfig = (state: WebListFormState): DiscoverySourceWebListConfig | null => {
  if (!state.enabled) {
    return null
  }
  const listContainerSelector = trimOrNull(state.listContainerSelector)
  const itemSelector = trimOrNull(state.itemSelector)
  if (!listContainerSelector || !itemSelector) {
    return null
  }

  const fields: Record<string, DiscoverySourceWebListSelector> = {}
  const maybeTitle = toSelectorConfig(state.fields.title)
  if (maybeTitle) fields.title = maybeTitle
  const maybeUrl = toSelectorConfig(state.fields.url)
  if (maybeUrl) fields.url = maybeUrl
  const maybeExcerpt = toSelectorConfig(state.fields.excerpt)
  if (maybeExcerpt) fields.excerpt = maybeExcerpt
  const maybeTimestamp = toSelectorConfig(state.fields.timestamp)
  if (maybeTimestamp) fields.timestamp = maybeTimestamp

  const config: DiscoverySourceWebListConfig = {
    listContainerSelector,
    itemSelector,
    fields,
  }

  if (state.pagination.enabled) {
    const nextPage = trimOrNull(state.pagination.nextPageSelector)
    const maxDepth = Number.isFinite(state.pagination.maxDepth) && state.pagination.maxDepth > 0
      ? Math.min(Math.max(Math.round(state.pagination.maxDepth), 1), 20)
      : DEFAULT_WEB_LIST_MAX_DEPTH
    if (nextPage) {
      config.pagination = {
        nextPage: {
          selector: nextPage,
        },
        maxDepth,
      }
    }
  }

  return config
}

type UseListConfigOptions = {
  initialConfig: DiscoverySourceWebListConfig | null
  initialEnabled: boolean
  suggestion?: WebListSuggestionState | null
}

export function useListConfig(options: UseListConfigOptions) {
  const form = reactive<WebListFormState>({
    enabled: options.initialEnabled,
    listContainerSelector: options.initialConfig?.listContainerSelector ?? '',
    itemSelector: options.initialConfig?.itemSelector ?? '',
    fields: createFieldsFormState(options.initialConfig),
    pagination: createPaginationFormState(options.initialConfig),
  })

  const appliedSuggestionId = ref<string | null>(null)
  const errors = ref<ValidationErrors>({})

  watch(
    () => [form.listContainerSelector, form.itemSelector, form.enabled],
    () => {
      errors.value = {}
    },
  )

  function reset(config: DiscoverySourceWebListConfig | null, enabled: boolean) {
    resetting = true
    form.enabled = enabled
    form.listContainerSelector = config?.listContainerSelector ?? ''
    form.itemSelector = config?.itemSelector ?? ''
    form.fields = createFieldsFormState(config)
    form.pagination = createPaginationFormState(config)
    appliedSuggestionId.value = null
    errors.value = {}
    isDirty.value = false
    resetting = false
  }

  function applySuggestion(suggestion: WebListSuggestionState) {
    reset(suggestion.config, true)
    appliedSuggestionId.value = suggestion.id
  }

  function discardSuggestion(config: DiscoverySourceWebListConfig | null, enabled: boolean) {
    reset(config, enabled)
    appliedSuggestionId.value = null
  }

  function validate() {
  const nextConfig = buildWebListConfig(form)
    if (!form.enabled) {
      errors.value = {}
      return {
        valid: true as const,
        config: null,
        raw: null,
      }
    }
    if (!nextConfig) {
      errors.value = {
        listContainerSelector: ['List container selector is required'],
        itemSelector: ['Item selector is required'],
      }
      return {
        valid: false as const,
        config: null,
        raw: null,
      }
    }
    const raw = buildRawWebListPayload(nextConfig)
    const validation = discoverySourceWebListConfigInputSchema.safeParse(raw)
    if (!validation.success) {
      const nextErrors: ValidationErrors = {}
      validation.error.issues.forEach((issue) => {
        const key = mapIssuePath(issue.path)
        if (!nextErrors[key]) {
          nextErrors[key] = []
        }
        nextErrors[key]!.push(issue.message)
      })
      errors.value = nextErrors
      return {
        valid: false as const,
        config: null,
        raw: null,
      }
    }
    errors.value = {}
    return {
      valid: true as const,
      config: nextConfig,
      raw,
    }
  }

  const isDirty = ref(false)
  let resetting = false

  watch(form, () => {
    if (resetting) return
    isDirty.value = true
  }, { deep: true })

  const hasFieldErrors = computed(() => Object.keys(errors.value).length > 0)

  return {
    form,
    errors,
    appliedSuggestionId,
    isDirty,
    hasFieldErrors,
    reset,
    applySuggestion,
    discardSuggestion,
    validate,
  }
}

function buildRawWebListPayload(config: DiscoverySourceWebListConfig): Record<string, unknown> | null {
  const serialized = serializeDiscoverySourceConfig({ webList: config })
  const webList = serialized?.webList
  return webList && typeof webList === 'object' ? webList as Record<string, unknown> : null
}
