import { applySandboxCors, requireFlexSandboxEnabled } from '../../../../../../../src/utils/flex-sandbox'

export default defineEventHandler((event) => {
  applySandboxCors(event)
  requireFlexSandboxEnabled()
  event.node.res.statusCode = 204
})
