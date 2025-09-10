import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import App from '../App.vue'
import vuetify from '../plugins/vuetify'
import PlaceholderView from '../views/PlaceholderView.vue'

describe('App', () => {
  it('mounts with router + vuetify and renders layout', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', name: 'dashboard', component: PlaceholderView, props: { title: 'Dashboard' } },
        { path: '/briefs', name: 'briefs', component: PlaceholderView, props: { title: 'Briefs' } },
        { path: '/inbox', name: 'inbox', component: PlaceholderView, props: { title: 'Inbox' } },
        { path: '/clients', name: 'clients', component: PlaceholderView, props: { title: 'Clients' } },
        { path: '/assets', name: 'assets', component: PlaceholderView, props: { title: 'Assets' } },
        { path: '/analytics', name: 'analytics', component: PlaceholderView, props: { title: 'Analytics' } },
        { path: '/sandbox', name: 'sandbox', component: PlaceholderView, props: { title: 'Sandbox' } },
        { path: '/settings', name: 'settings', component: PlaceholderView, props: { title: 'Settings' } },
      ],
    })
    router.push('/')
    await router.isReady()

    const pinia = createPinia()

    const wrapper = mount(App, {
      global: {
        plugins: [vuetify, router, pinia],
      },
    })
    expect(wrapper.text()).toContain('AwesomePoster')
    expect(wrapper.text()).toContain('Dashboard')
  })
})
