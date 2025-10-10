/**
 * Centralized default model resolution for the agents server.
 *
 * Precedence:
 *  1) OPENAI_DEFAULT_MODEL (preferred; aligns with @openai/agents-core)
 *  2) OPENAI_MODEL (legacy)
 *  3) 'gpt-4o' fallback
 */
export const DEFAULT_MODEL_FALLBACK = 'gpt-4o'

export function getDefaultModelName(): string {
  const m =
    process.env.FLEX_OPENAI_DEFAULT_MODEL ||
    process.env.OPENAI_DEFAULT_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_MODEL_FALLBACK
  return m.trim()
}
