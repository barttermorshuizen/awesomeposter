import { describe, expect, it } from 'vitest'

import { CapabilityRegistrationSchema } from '../../src/flex/types.js'

const baseRegistration = {
  capabilityId: 'post.copywriter',
  version: '1.0.0',
  displayName: 'Copywriter Capability',
  summary: 'Writes compelling post copy',
  kind: 'execution' as const,
  outputContract: {
    mode: 'freeform',
    instructions: 'Return the final copy block.'
  }
}

describe('CapabilityRegistrationSchema postConditions', () => {
  it('compiles DSL expressions into canonical JSON-Logic payloads', () => {
    const parsed = CapabilityRegistrationSchema.parse({
      ...baseRegistration,
      postConditions: [
        {
          facet: 'post_copy',
          path: '/status',
          condition: {
            dsl: 'status == "ready"'
          }
        }
      ]
    })

    expect(parsed.postConditions).toHaveLength(1)
    const [condition] = parsed.postConditions!
    expect(condition.condition.canonicalDsl).toBeTruthy()
    expect(condition.condition.jsonLogic).toBeTruthy()
    expect(condition.condition.variables).toBeDefined()
    expect(condition.condition.variables?.[0]).toContain('status')
  })

  it('rejects duplicate facet/path combinations', () => {
    expect(() =>
      CapabilityRegistrationSchema.parse({
        ...baseRegistration,
        postConditions: [
          {
            facet: 'post_copy',
            path: '/status',
            condition: { dsl: 'status == "ready"' }
          },
          {
            facet: 'post_copy',
            path: '/status',
            condition: { dsl: 'status == "ready"' }
          }
        ]
      })
    ).toThrow(/Duplicate post-condition/)
  })

  it('rejects blank JSON-pointer paths', () => {
    expect(() =>
      CapabilityRegistrationSchema.parse({
        ...baseRegistration,
        postConditions: [
          {
            facet: 'post_copy',
            path: '   ',
            condition: { dsl: 'status == "ready"' }
          }
        ]
      })
    ).toThrow(/JSON-pointer path must be provided/)
  })

  it('requires a valid capability kind value', () => {
    expect(() =>
      CapabilityRegistrationSchema.parse({
        ...baseRegistration,
        // @ts-expect-error intentional invalid union entry for test coverage
        kind: 'strategy'
      })
    ).toThrow(/Invalid enum value/)
  })

  it('rejects registrations that omit the kind property', () => {
    const { kind, ...withoutKind } = baseRegistration
    expect(() => CapabilityRegistrationSchema.parse(withoutKind as unknown as typeof baseRegistration)).toThrow(
      /Required/
    )
  })
})
