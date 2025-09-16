// Shared scoring helpers used across agents and tools
// Centralizes composite score calculation so the UI and backend stay consistent.

import { scoringWeights } from './types.js'

export type CompositeInputs = {
  readability: number | null | undefined
  clarity: number | null | undefined
  objectiveFit: number | null | undefined
  brandRisk: number | null | undefined
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/**
 * Compute weighted composite quality score.
 * Brand risk is applied inversely (low risk increases score) while preserving
 * the previous calibration by subtracting the weight magnitude as an offset.
 *
 * Formula (expanded):
 *  r*w_r + c*w_c + o*w_o + |w_br|*(1 - br) - |w_br|
 * which is algebraically equivalent to: r*w_r + c*w_c + o*w_o - |w_br|*br
 */
export function computeCompositeScore(
  { readability, clarity, objectiveFit, brandRisk }: CompositeInputs,
  opts?: { platform?: string; weights?: Partial<typeof scoringWeights> }
): number {
  const r = clamp01(Number(readability ?? 0))
  const c = clamp01(Number(clarity ?? 0))
  const o = clamp01(Number(objectiveFit ?? 0))
  const br = clamp01(Number(brandRisk ?? 0))

  // Select weights: allow explicit override, else platform-tuned defaults, else global defaults
  type Weights = { readability: number; objectiveFit: number; clarity: number; brandRisk: number }
  const base: Weights = scoringWeights as unknown as Weights
  let w: Weights = base
  if (opts?.weights && typeof opts.weights === 'object') {
    w = { ...base, ...opts.weights } as Weights
  } else if (opts?.platform) {
    const p = String(opts.platform).toLowerCase()
    if (p === 'linkedin') {
      w = { ...base, readability: 0.40, clarity: 0.25, objectiveFit: 0.25, brandRisk: -0.20 }
    } else if (p === 'x' || p === 'twitter') {
      w = { ...base, readability: 0.25, clarity: 0.35, objectiveFit: 0.30, brandRisk: -0.20 }
    } else {
      w = base
    }
  }
  const brW = Math.abs(w.brandRisk)

  const score = (
    r * w.readability +
    o * w.objectiveFit +
    c * w.clarity +
    brW * (1 - br) -
    brW
  )

  return clamp01(score)
}
