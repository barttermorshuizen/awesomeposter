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
