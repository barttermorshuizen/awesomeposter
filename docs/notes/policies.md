> **Legacy Note:** The canonical Flex policy schema now lives in code. This document remains as historical context only.

- Source of truth: `packages/shared/src/flex/policies.ts`
- Type exports: `@awesomeposter/shared/flex` (`TaskPolicies`, `PlannerPolicy`, `RuntimePolicy`, `PolicyTrigger`, `NodeSelector`, `Action`)
- Validation helper: `parseTaskPolicies(...)`

### Quick Reference

```ts
import { parseTaskPolicies } from '@awesomeposter/shared/flex'

const policies = parseTaskPolicies({
  planner: {
    topology: { variantCount: 3 },
    optimisation: { objective: 'quality' },
    directives: { requiresHitlApproval: true }
  },
  runtime: [
    {
      id: 'qa_replan',
      trigger: { kind: 'onNodeComplete', selector: { kind: 'qa' } },
      action: { type: 'replan', rationale: 'QA requested revisions' }
    }
  ]
})
```

Use this file when you need copy/paste snippets; keep the actual schema changes in the shared module above.
