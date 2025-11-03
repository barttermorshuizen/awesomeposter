import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import CompanyInformationWidget from '@/components/flex-tasks/widgets/CompanyInformationWidget.vue'
import vuetify from '@/plugins/vuetify'
import type { CompanyInformationFacetRecord } from '@/stores/flexTasks'
import { useNotificationsStore } from '@/stores/notifications'

describe('CompanyInformationWidget', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  function mountWidget(modelValue: CompanyInformationFacetRecord) {
    return mount(CompanyInformationWidget, {
      props: {
        modelValue,
        definition: {
          title: 'Company information'
        } as any,
        schema: {
          type: 'object'
        }
      },
      global: {
        plugins: [vuetify]
      }
    })
  }

  async function expandPanel(wrapper: VueWrapper) {
    const header = wrapper.get('[data-test="company-info-panel-title"]')
    await header.trigger('click')
    await wrapper.vm.$nextTick()
  }

  it('renders populated company information with website and assets', async () => {
    const wrapper = mountWidget({
      name: 'Acme Analytics',
      website: 'https://acmeanalytics.example.com',
      industry: 'Industrial IoT',
      toneOfVoice: 'Authoritative but friendly',
      specialInstructions: 'Always include certified partner badge.',
      audienceSegments: 'Operations leaders',
      preferredChannels: 'LinkedIn, industry newsletters',
      brandAssets: [
        {
          uri: 'https://cdn.example.com/assets/logo.png',
          label: 'Logo'
        },
        {
          uri: 'https://cdn.example.com/assets/brand-guide.pdf',
          label: 'Brand Guide'
        }
      ]
    })

    expect(wrapper.get('[data-test="company-info-panel-title"]').text()).toBe('Company information')

    await expandPanel(wrapper)

    expect(wrapper.get('[data-test="company-info-name"]').text()).toBe('Acme Analytics')
    expect(wrapper.get('[data-test="company-info-website"]').attributes('href')).toBe(
      'https://acmeanalytics.example.com'
    )

    expect(wrapper.get('[data-test="company-info-field-industry"]').text()).toContain('Industrial IoT')
    expect(wrapper.get('[data-test="company-info-field-tone_of_voice"]').text()).toContain(
      'Authoritative but friendly'
    )
    expect(wrapper.get('[data-test="company-info-field-audience_segments"]').text()).toContain(
      'Operations leaders'
    )
    expect(wrapper.get('[data-test="company-info-field-preferred_channels"]').text()).toContain(
      'LinkedIn, industry newsletters'
    )

    const instructions = wrapper.get('[data-test="company-info-instructions"]').text()
    expect(instructions).toContain('Always include certified partner badge.')

    const assets = wrapper.findAll('[data-test="company-info-asset"]')
    expect(assets).toHaveLength(2)

    const firstThumb = assets[0].find('[data-test="company-info-asset-thumb"]')
    expect(firstThumb.exists()).toBe(true)
    const secondPlaceholder = assets[1].find('[data-test="company-info-asset-placeholder"]')
    expect(secondPlaceholder.exists()).toBe(true)

    const downloadButtons = wrapper.findAll('[data-test="company-info-asset-download"]')
    expect(downloadButtons).toHaveLength(2)
    expect(downloadButtons[0].attributes('href')).toBe('https://cdn.example.com/assets/logo.png')
  })

  it('shows placeholders when optional fields are missing', async () => {
    const wrapper = mountWidget({
      name: null,
      website: null,
      industry: null,
      toneOfVoice: null,
      specialInstructions: null,
      audienceSegments: null,
      preferredChannels: null,
      brandAssets: []
    })

    await expandPanel(wrapper)

    expect(wrapper.get('[data-test="company-info-name"]').text()).toBe('Company name unavailable')
    expect(wrapper.find('[data-test="company-info-website"]').exists()).toBe(false)
    expect(wrapper.get('[data-test="company-info-field-industry"]').text()).toContain('Industry not provided')
    expect(wrapper.get('[data-test="company-info-instructions"]').text()).toContain(
      'Special instructions not provided'
    )
    expect(wrapper.get('[data-test="company-info-assets-empty"]').text()).toContain('No brand assets provided.')
  })

  it('falls back to placeholder when thumbnail fails and notifies operator', async () => {
    const notifications = useNotificationsStore()
    const enqueueSpy = vi.spyOn(notifications, 'enqueue')

    const wrapper = mountWidget({
      name: 'Contoso',
      website: null,
      industry: null,
      toneOfVoice: null,
      specialInstructions: null,
      audienceSegments: null,
      preferredChannels: null,
      brandAssets: [
        {
          uri: 'https://cdn.example.com/assets/logo.png',
          label: 'Logo'
        }
      ]
    })

    await expandPanel(wrapper)

    const thumb = wrapper.get('[data-test="company-info-asset-thumb"]')
    await thumb.trigger('error')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-test="company-info-asset-thumb"]').exists()).toBe(false)
    expect(wrapper.find('[data-test="company-info-asset-placeholder"]').exists()).toBe(true)
    expect(enqueueSpy).toHaveBeenCalledTimes(1)
    const payload = enqueueSpy.mock.calls[0]?.[0] as { message?: string; kind?: string } | undefined
    expect(payload?.message).toContain('Logo')
    expect(payload?.kind).toBe('warning')
  })
})
