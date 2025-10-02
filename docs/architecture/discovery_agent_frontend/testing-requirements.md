# Testing Requirements
- **Stores**: Unit-test filter merging, SSE application, and optimistic updates via Vitest.
- **Components**: Use Vue Test Utils to verify list rendering, empty states, form validation, and bulk action flows.
- **Routing**: Add a guard test ensuring discovery routes redirect when the feature flag is disabled.
- **Accessibility**: Deferred until post-validation stage; no automated checks required for MVP.

```ts
// tests/discovery/DiscoveryDashboardView.spec.ts
import { render, screen, fireEvent } from '@testing-library/vue'
import DiscoveryDashboardView from '@/views/discovery/DiscoveryDashboardView.vue'
import { createTestingPinia } from '@pinia/testing'

it('renders brief list and triggers bulk promote', async () => {
  const pinia = createTestingPinia({ stubActions: false })
  const { getByRole, emitted } = render(DiscoveryDashboardView, { global: { plugins: [pinia] } })

  await screen.findByText('Spotted briefs')
  await fireEvent.click(getByRole('checkbox', { name: /select row/i }))
  await fireEvent.click(getByRole('button', { name: /promote/i }))

  const store = useDiscoveryBriefsStore()
  expect(store.runBulk).toHaveBeenCalledWith({ kind: 'promote', note: expect.any(String) })
  expect(emitted()).toMatchSnapshot()
})
```

- Extend Cypress/Playwright smoke scripts later if end-to-end coverage becomes necessary; not required for MVP.
