import { describe, expect, it } from 'vitest'
import { discoveryPromoteItemInputSchema } from '../item.js'

describe('discoveryPromoteItemInputSchema', () => {
  it('accepts ASCII notes with sufficient length', () => {
    const result = discoveryPromoteItemInputSchema.parse({ note: 'Looks good to me' })
    expect(result.note).toBe('Looks good to me')
  })

  it('rejects notes shorter than five characters', () => {
    expect(() => discoveryPromoteItemInputSchema.parse({ note: 'nope' })).toThrow()
  })

  it('rejects notes containing non-ASCII characters', () => {
    expect(() => discoveryPromoteItemInputSchema.parse({ note: 'great 😊' })).toThrow()
  })
})
