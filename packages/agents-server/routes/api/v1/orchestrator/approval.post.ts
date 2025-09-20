import { z } from 'zod'
import { defineEventHandler, readBody } from 'h3'
import { getApprovalStore } from '../../../../src/services/approval-store'

const ApprovalDecisionSchema = z.object({
  checkpointId: z.string().min(1),
  status: z.enum(['approved', 'rejected']),
  decidedBy: z.string().min(1).optional(),
  decisionNotes: z.string().optional()
})

export default defineEventHandler(async (event) => {
  const body = (event as any).context?.body ?? (await readBody(event))
  const payload = ApprovalDecisionSchema.parse(body)

  const store = getApprovalStore()
  const entry = store.resolve(payload.checkpointId, {
    status: payload.status,
    decidedBy: payload.decidedBy,
    decisionNotes: payload.decisionNotes
  })

  if (!entry) {
    throw createError({ statusCode: 404, statusMessage: 'Checkpoint not found' })
  }

  return { ok: true, checkpointId: entry.checkpointId, status: entry.status }
})
