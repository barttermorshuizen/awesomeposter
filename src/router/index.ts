import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: () => import('@/views/PlaceholderView.vue'),
      props: () => ({
        title: 'Dashboard',
        icon: 'mdi-view-dashboard-outline',
        description: 'Metrics tiles, activity feed, shortcuts, knob performance insights.',
      }),
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
      component: () => import('@/views/PlaceholderView.vue'),
      props: () => ({
        title: 'Settings screen',
        icon: 'mdi-cog-outline',
        description: 'Application and client settings.',
      }),
    },
    {
      path: '/sandbox',
      name: 'sandbox',
      component: () => import('@/views/SandboxView.vue'),
    },
  ],
})

export default router
