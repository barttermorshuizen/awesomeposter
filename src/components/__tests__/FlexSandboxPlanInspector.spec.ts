import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { CapabilityRecord } from '@awesomeposter/shared'
import FlexSandboxPlanInspector from '../FlexSandboxPlanInspector.vue'
import vuetify from '@/plugins/vuetify'
import type { FlexSandboxPlan } from '@/lib/flexSandboxTypes'

const capability: CapabilityRecord = {
  capabilityId: 'writer.v1',
  version: '1.0',
  displayName: 'Writer',
  summary: 'Writes content',
  status: 'active',
  preferredModels: [],
  outputContract: { mode: 'json_schema', schema: { type: 'object' } },
  inputContract: undefined,
  inputTraits: undefined,
  cost: undefined,
  heartbeat: undefined,
  metadata: undefined,
  lastSeenAt: new Date().toISOString(),
  registeredAt: new Date().toISOString(),
  inputFacets: ['objectiveBrief'],
  outputFacets: ['copyVariants']
}

describe('FlexSandboxPlanInspector', () => {
  it('shows placeholder when plan is missing', () => {
    const wrapper = mount(FlexSandboxPlanInspector, {
      props: {
        plan: null,
        capabilityCatalog: [capability]
      },
      global: {
        plugins: [vuetify]
      }
    })

    expect(wrapper.text()).toContain('Plan Inspector')
    expect(wrapper.text()).toContain('Planner has not produced any nodes yet')
  })

  it('renders plan nodes with derived metadata', async () => {
    const plan: FlexSandboxPlan = {
      runId: 'run-123',
      version: 2,
      metadata: { scenario: 'test' },
      nodes: [
        {
          id: 'node-1',
          capabilityId: 'writer.v1',
          label: 'Draft content',
          status: 'running',
          kind: 'execution',
          facets: { input: ['objectiveBrief'], output: ['copyVariants'] },
          contracts: { inputMode: undefined, outputMode: 'json_schema' },
          metadata: { plannerStage: 'execution' },
          derivedFrom: null,
          lastUpdatedAt: new Date().toISOString()
        },
        {
          id: 'node-2',
          capabilityId: 'qa.v1',
          label: 'QA review',
          status: 'pending',
          kind: 'validation',
          facets: { input: ['copyVariants'], output: ['qaFindings'] },
          contracts: { inputMode: undefined, outputMode: 'json_schema' },
          metadata: { derived: true },
          derivedFrom: 'writer.v1',
          lastUpdatedAt: new Date().toISOString()
        }
      ],
      history: [
        { version: 1, timestamp: new Date().toISOString(), trigger: 'initial' },
        { version: 2, timestamp: new Date().toISOString(), trigger: 'replan' }
      ]
    }

    const qaCapability: CapabilityRecord = {
      ...capability,
      capabilityId: 'qa.v1',
      displayName: 'QA Agent'
    }

    const wrapper = mount(FlexSandboxPlanInspector, {
      props: {
        plan,
        capabilityCatalog: [capability, qaCapability]
      },
      global: {
        plugins: [vuetify]
      }
    })

    const panels = wrapper.findAll('.v-expansion-panel-title')
    expect(panels).toHaveLength(2)
    await panels[1].trigger('click')

    expect(wrapper.text()).toContain('v2')
    expect(wrapper.text()).toContain('Draft content')
    expect(wrapper.text()).toContain('QA review')
    expect(wrapper.text()).toContain('Derived via Writer')
    expect(wrapper.text()).toContain('Facets')
  })
})
