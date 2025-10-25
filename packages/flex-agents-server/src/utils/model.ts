/**
 * Centralized default model resolution for the agents server.
 *
 * Precedence:
 *  1) OPENAI_DEFAULT_MODEL (preferred; aligns with @openai/agents-core)
 *  2) OPENAI_MODEL (legacy)
 *  3) 'gpt-5' fallback
 */
export const DEFAULT_MODEL_FALLBACK = 'gpt-5'

export function getDefaultModelName(): string {
  const m =
    process.env.FLEX_OPENAI_DEFAULT_MODEL ||
    process.env.OPENAI_DEFAULT_MODEL ||
    process.env.OPENAI_MODEL ||
    DEFAULT_MODEL_FALLBACK
  return m.trim()
}
