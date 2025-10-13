// @vitest-environment node
import { describe, it, expect } from 'vitest'
import type { CapabilityRecord, TaskEnvelope } from '@awesomeposter/shared'

import { FlexPlanner, UnsupportedObjectiveError } from '../src/services/flex-planner'
import { CONTENT_CAPABILITY_ID } from '../src/agents/content-generator'

const linkedInCapability: CapabilityRecord = {
  capabilityId: CONTENT_CAPABILITY_ID,
  version: '1.0.0',
  displayName: 'Copywriter – LinkedIn Variants',
  summary: 'Generates LinkedIn post variants.',
  inputTraits: { formats: ['linkedin_post'] },
  defaultContract: {
    mode: 'json_schema',
    schema: {
      type: 'object',
      required: ['variants'],
      properties: {
        variants: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['headline', 'body', 'callToAction'],
            properties: {
              headline: { type: 'string' },
              body: { type: 'string' },
              callToAction: { type: 'string' }
            }
          }
        }
      }
    }
  },
  cost: { tier: 'standard' },
  preferredModels: ['gpt-4o'],
  heartbeat: { intervalSeconds: 600, timeoutSeconds: 1800 },
  metadata: {
    scenarios: ['linkedin_post_variants']
  },
  status: 'active',
  lastSeenAt: new Date().toISOString(),
  registeredAt: new Date().toISOString()
}

describe('FlexPlanner', () => {
  it('selects registered capabilities by scenario metadata', async () => {
    const registry = {
      async listActive() {
        return [linkedInCapability]
      },
      async getCapabilityById() {
        return linkedInCapability
      }
    }

    const planner = new FlexPlanner(registry as any, {
      now: () => new Date('2025-04-01T12:00:00.000Z')
    })

    const envelope: TaskEnvelope = {
      objective: 'Create LinkedIn post variants that highlight developer experience improvements',
      inputs: {
        channel: 'linkedin',
        variantCount: 2
      },
      outputContract: {
        mode: 'json_schema',
        schema: {
          type: 'object',
          properties: {}
        }
      }
    }

    const plan = await planner.buildPlan('run_123', envelope)

    expect(plan.nodes).toHaveLength(1)
    expect(plan.nodes[0].capabilityId).toBe(CONTENT_CAPABILITY_ID)
    expect(plan.nodes[0].bundle.inputs?.variantCount).toBe(2)
  })

  it('throws when no registered capability matches the scenario', async () => {
    const registry = {
      async listActive() {
        return []
      },
      async getCapabilityById() {
        return undefined
      }
    }

    const planner = new FlexPlanner(registry as any, {
      now: () => new Date()
    })

    const envelope: TaskEnvelope = {
      objective: 'Create a TikTok script',
      inputs: {
        channel: 'tiktok'
      },
      outputContract: {
        mode: 'json_schema',
        schema: {
          type: 'object',
          properties: {}
        }
      }
    }

    await expect(() => planner.buildPlan('run_456', envelope)).rejects.toThrow(UnsupportedObjectiveError)
  })
})
