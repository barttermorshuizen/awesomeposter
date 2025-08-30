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
      component: () => import('@/views/PlaceholderView.vue'),
      props: () => ({
        title: 'Briefs screen',
        icon: 'mdi-file-document-edit-outline',
        description: 'Table with filters, row/bulk actions, knob settings display.',
      }),
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
  ],
})

export default router
