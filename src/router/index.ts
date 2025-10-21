import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { isConditionPlaygroundEnabledClient, isFlexSandboxEnabledClient } from '@/lib/featureFlags'

const flexSandboxEnabled = isFlexSandboxEnabledClient()
const conditionPlaygroundEnabled = isConditionPlaygroundEnabledClient()

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/discovery/loadDiscoveryDashboard').then((mod) => mod.default()),
    },
    {
      path: '/briefs',
      name: 'briefs',
      component: () => import('@/views/BriefsView.vue'),
    },
    {
      path: '/briefs/new',
      name: 'briefs-new',
      component: () => import('@/views/BriefsNewView.vue'),
    },
    {
      path: '/briefs/:id/edit',
      name: 'briefs-edit',
      component: () => import('@/views/BriefsEditView.vue'),
    },
    {
      path: '/inbox',
      name: 'inbox',
      component: () => import('@/views/PlaceholderView.vue'),
      props: () => ({
        title: 'Inbox screen',
        icon: 'mdi-inbox-arrow-down-outline',
        description: 'Task-focused view with filters.',
      }),
    },
    {
      path: '/clients',
      name: 'clients',
      component: () => import('@/views/ClientsView.vue'),
    },
    {
      path: '/clients/new',
      name: 'clients-new',
      component: () => import('@/views/ClientsNewView.vue'),
    },
    {
      path: '/clients/:id/edit',
      name: 'clients-edit',
      component: () => import('@/views/ClientsEditView.vue'),
    },
    {
      path: '/assets',
      name: 'assets',
      component: () => import('@/views/PlaceholderView.vue'),
      props: () => ({
        title: 'Assets screen',
        icon: 'mdi-folder-multiple-image',
        description: 'Library with filters and search.',
      }),
    },
    {
      path: '/analytics',
      name: 'analytics',
      component: () => import('@/views/PlaceholderView.vue'),
      props: () => ({
        title: 'Analytics screen',
        icon: 'mdi-chart-line',
        description: 'Knob effectiveness, performance trends, A/B test results.',
      }),
    },
    {
      path: '/settings',
      name: 'settings',
      component: () => import('@/views/SettingsView.vue'),
    },
    {
      path: '/sandbox',
      name: 'sandbox',
      component: () => import('@/views/SandboxView.vue'),
    },
    ...(flexSandboxEnabled
      ? ([
          {
            path: '/flex/sandbox',
            name: 'flex-sandbox',
            component: () => import('@/views/FlexSandboxView.vue'),
          },
        ] satisfies RouteRecordRaw[])
      : []),
    ...(conditionPlaygroundEnabled
      ? ([
          {
            path: '/dev/condition-playground',
            name: 'condition-playground',
            component: () => import('@/views/ConditionPlaygroundView.vue'),
          },
        ] satisfies RouteRecordRaw[])
      : []),
  ],
})

export default router
