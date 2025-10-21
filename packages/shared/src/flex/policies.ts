import { z } from 'zod'

const LooseRecordSchema = z.record(z.unknown())

export const NodeSelectorSchema = z.object({
  nodeId: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
  capabilityId: z.string().min(1).optional()
})
export type NodeSelector = z.infer<typeof NodeSelectorSchema>

export const PolicyTriggerSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('onStart')
  }),
  z.object({
    kind: z.literal('onNodeComplete'),
    selector: NodeSelectorSchema.optional(),
    condition: LooseRecordSchema.optional()
  }),
  z.object({
    kind: z.literal('onValidationFail'),
    selector: NodeSelectorSchema.optional(),
    condition: LooseRecordSchema.optional()
  }),
  z.object({
    kind: z.literal('onTimeout'),
    ms: z.number().positive()
  }),
  z.object({
    kind: z.literal('onMetricBelow'),
    metric: z.string().min(1),
    threshold: z.number()
  }),
  z.object({
    kind: z.literal('manual')
  })
])
export type PolicyTrigger = z.infer<typeof PolicyTriggerSchema>

export const ActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('goto'),
    next: z.string().min(1)
  }),
  z.object({
    type: z.literal('replan'),
    rationale: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal('hitl'),
    rationale: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal('fail'),
    message: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal('pause'),
    reason: z.string().min(1).optional()
  }),
  z.object({
    type: z.literal('emit'),
    event: z.string().min(1),
    payload: LooseRecordSchema.optional()
  })
])
export type Action = z.infer<typeof ActionSchema>

export const RuntimePolicySchema = z
  .object({
    id: z.string().min(1),
    enabled: z.boolean().default(true),
    trigger: PolicyTriggerSchema,
    action: ActionSchema
  })
  .transform((policy) => ({
    ...policy,
    enabled: policy.enabled ?? true
  }))
export type RuntimePolicy = z.infer<typeof RuntimePolicySchema>

const UniqueStringArray = z
  .array(z.string().min(1))
  .default([])
  .transform((values) => Array.from(new Set(values)))

export const PlannerPolicySchema = z.object({
  topology: z
    .object({
      variantCount: z.number().int().positive().max(6).optional(),
      maxDepth: z.number().int().positive().optional(),
      requiredKinds: UniqueStringArray,
      forbiddenKinds: UniqueStringArray
    })
    .partial()
    .optional(),
  selection: z
    .object({
      require: UniqueStringArray,
      forbid: UniqueStringArray,
      prefer: UniqueStringArray,
      avoid: UniqueStringArray
    })
    .partial()
    .optional(),
  optimisation: z
    .object({
      objective: z.enum(['speed', 'quality', 'diversity', 'token_efficiency']).optional(),
      maxTokens: z.number().int().positive().optional()
    })
    .optional(),
  directives: LooseRecordSchema.optional()
})
export type PlannerPolicy = z.infer<typeof PlannerPolicySchema>

export const TaskPoliciesSchema = z
  .object({
    planner: PlannerPolicySchema.optional(),
    runtime: z.array(RuntimePolicySchema).default([])
  })
  .transform((policies) => ({
    planner: policies.planner,
    runtime: policies.runtime ?? []
  }))
export type TaskPolicies = z.infer<typeof TaskPoliciesSchema>

export function parseTaskPolicies(input: unknown): TaskPolicies {
  return TaskPoliciesSchema.parse(input)
}
