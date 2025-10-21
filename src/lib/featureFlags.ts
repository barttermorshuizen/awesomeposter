export function readBooleanFlag(value: unknown): boolean {
  if (value === undefined || value === null) return false
  const normalized = String(value).trim().toLowerCase()
  return normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on'
}

export function isFlexSandboxEnabledClient(): boolean {
  const raw =
    import.meta.env.VITE_USE_FLEX_DEV_SANDBOX ??
    import.meta.env.USE_FLEX_DEV_SANDBOX ??
    import.meta.env.VITE_USE_FLEX_SANDBOX ??
    import.meta.env.USE_FLEX_SANDBOX
  return readBooleanFlag(raw)
}

export function isConditionPlaygroundEnabledClient(): boolean {
  if (!import.meta.env.DEV) return false

  const envFlag =
    import.meta.env.VITE_ENABLE_CONDITION_PLAYGROUND ??
    import.meta.env.ENABLE_CONDITION_PLAYGROUND

  const queryFlag =
    typeof window !== 'undefined'
      ? (() => {
          const params = new URLSearchParams(window.location.search)
          const value = params.get('condition_playground')
          return readBooleanFlag(value)
        })()
      : false

  return readBooleanFlag(envFlag) || queryFlag
}
