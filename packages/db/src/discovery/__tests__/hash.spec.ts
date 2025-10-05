import { describe, it, expect } from 'vitest'
import { computeRawHash } from '../index.js'

describe('computeRawHash', () => {
  it('produces stable hashes for equivalent payloads regardless of key order', () => {
    const payloadA = { foo: 'bar', nested: { alpha: 1, beta: [1, 2, 3] } }
    const payloadB = { nested: { beta: [1, 2, 3], alpha: 1 }, foo: 'bar' }

    const hashA = computeRawHash(payloadA)
    const hashB = computeRawHash(payloadB)

    expect(hashA).toBe(hashB)
  })

  it('changes hash when payload content differs', () => {
    const baseline = { foo: 'bar', nested: { alpha: 1 } }
    const variant = { foo: 'bar', nested: { alpha: 2 } }

    const baselineHash = computeRawHash(baseline)
    const variantHash = computeRawHash(variant)

    expect(baselineHash).not.toBe(variantHash)
  })
})
