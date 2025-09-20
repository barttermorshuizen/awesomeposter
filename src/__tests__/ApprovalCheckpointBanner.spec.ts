import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import type { PendingApproval } from '@awesomeposter/shared'
import ApprovalCheckpointBanner from '../components/ApprovalCheckpointBanner.vue'
import vuetify from '../plugins/vuetify'

describe('ApprovalCheckpointBanner', () => {
  it('renders approval details and emits actions', async () => {
    const pending: PendingApproval = {
      checkpointId: 'cp_123',
      reason: 'Legal review required',
      requestedBy: 'orchestrator',
      requestedAt: '2025-02-16T12:34:56.000Z',
      requiredRoles: ['legal'],
      evidenceRefs: ['asset_123'],
      advisory: {
        severity: 'warn',
        reason: 'Claims require legal review',
        evidenceRefs: ['generation_step'],
      },
      status: 'waiting',
    }

    const wrapper = mount(ApprovalCheckpointBanner, {
      props: {
        pending,
        notes: '',
        reviewer: '',
        busy: false,
        error: null,
      },
      global: {
        plugins: [vuetify],
      },
    })

    expect(wrapper.get('[data-testid="approval-banner"]').text()).toContain('Legal review required')
    expect(wrapper.get('[data-testid="approval-advisory"]').text()).toContain('Claims require legal review')
    expect(wrapper.get('[data-testid="approval-evidence"]').text()).toContain('asset_123')

    await wrapper.get('[data-testid="approval-reviewer"] input').setValue('Jane Reviewer')
    await wrapper.get('[data-testid="approval-notes"] textarea').setValue('Looks good to me')

    expect(wrapper.emitted()['update:reviewer']?.[0]).toEqual(['Jane Reviewer'])
    expect(wrapper.emitted()['update:notes']?.[0]).toEqual(['Looks good to me'])

    await wrapper.get('[data-testid="approval-approve"]').trigger('click')
    await wrapper.get('[data-testid="approval-reject"]').trigger('click')

    expect(wrapper.emitted().approve).toBeTruthy()
    expect(wrapper.emitted().reject).toBeTruthy()
  })
})
