import { z } from 'zod'
import { getApprovalStore } from '../../../../src/services/approval-store'
import { defineEventHandler, getQuery } from 'h3'

const QuerySchema = z.object({
  threadId: z.string().min(1)
})

export default defineEventHandler((event) => {
  const rawQuery = (event as any).context?.query ?? getQuery(event)
  const query = QuerySchema.parse(rawQuery)
  const store = getApprovalStore()
  const pending = store.listByThread(query.threadId)
  return { pending }
})
