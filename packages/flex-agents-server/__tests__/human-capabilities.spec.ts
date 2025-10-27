// @vitest-environment node
import { afterAll, describe, expect, it, vi } from 'vitest'

const MODULE_PATH = '../src/agents/human-clarify-brief'

async function loadClarifyModule(timeout?: string) {
  vi.resetModules()
  if (timeout === undefined) {
    delete process.env.FLEX_HUMAN_ASSIGNMENT_TIMEOUT_SECONDS
  } else {
    process.env.FLEX_HUMAN_ASSIGNMENT_TIMEOUT_SECONDS = timeout
  }
  return import(MODULE_PATH)
}

afterAll(async () => {
  delete process.env.FLEX_HUMAN_ASSIGNMENT_TIMEOUT_SECONDS
  await loadClarifyModule()
})

describe('HumanAgent.clarifyBrief capability', () => {
  it('exports structured metadata and facet-backed contracts', async () => {
    const module = await loadClarifyModule()
    const capability = module.HUMAN_CLARIFY_CAPABILITY

    expect(capability.agentType).toBe('human')
    expect(capability.inputContract?.mode).toBe('facets')
    expect(capability.inputContract?.facets).toEqual([
      'objectiveBrief',
      'audienceProfile',
      'toneOfVoice',
      'writerBrief',
      'clarificationRequest'
    ])
    expect(capability.outputContract?.mode).toBe('facets')
    expect(capability.outputContract?.facets).toEqual(['clarificationResponse'])
    expect(capability.assignmentDefaults?.onDecline).toBe('fail_run')
    expect(capability.assignmentDefaults?.maxNotifications).toBe(1)
    expect(capability.instructionTemplates?.app).toContain('human strategist')
    expect(capability.instructionTemplates?.summary).toMatch(/decline/i)
  })

  it('derives assignment timeout seconds from FLEX_HUMAN_ASSIGNMENT_TIMEOUT_SECONDS', async () => {
    const module = await loadClarifyModule('480')
    const capability = module.HUMAN_CLARIFY_CAPABILITY

    expect(module.HUMAN_ASSIGNMENT_TIMEOUT_SECONDS).toBe(480)
    expect(capability.assignmentDefaults?.timeoutSeconds).toBe(480)
    expect(capability.metadata?.assignmentPolicy).toMatchObject({
      timeoutSeconds: 480,
      onDecline: 'fail_run'
    })
  })
})
