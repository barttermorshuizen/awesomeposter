import {
  getMethod,
  getHeader,
  setHeader,
  sendNoContent,
  createError
} from 'h3'
import { FlexRunPersistence } from '../../../../../src/services/orchestrator-persistence'

const SENSITIVE_KEY_PATTERN = /(token|secret|apikey|api_key|authorization|password|bearer|credential)/i

function redact(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry))
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '[redacted]']
      }
      return [key, redact(val)]
    })
    return Object.fromEntries(entries)
  }
  return value
}

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'OPTIONS') {
    const origin = getHeader(event, 'origin')
    if (origin) {
      setHeader(event, 'Vary', 'Origin')
      setHeader(event, 'Access-Control-Allow-Origin', origin)
    }
    setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')
    setHeader(event, 'Access-Control-Allow-Headers', 'accept,authorization,content-type')
    setHeader(event, 'Access-Control-Max-Age', 600)
    return sendNoContent(event, 204)
  }

  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')
  setHeader(event, 'Access-Control-Allow-Headers', 'accept,authorization,content-type')
  setHeader(event, 'Cache-Control', 'no-store')

  const params = (event.context.params ?? {}) as { id?: string }
  const runId = params.id
  if (!runId) {
    throw createError({ statusCode: 400, statusMessage: 'Run id is required', data: { code: 'run_id_missing' } })
  }

  const persistence = new FlexRunPersistence()
  const debugView = await persistence.loadFlexRunDebug(runId)
  if (!debugView) {
    throw createError({ statusCode: 404, statusMessage: 'Run not found', data: { code: 'run_not_found' } })
  }

  const latestSnapshot = debugView.snapshots[debugView.snapshots.length - 1] ?? null

  return {
    ok: true,
    run: {
      runId: debugView.run.runId,
      status: debugView.run.status,
      threadId: debugView.run.threadId ?? null,
      objective: debugView.run.objective ?? null,
      schemaHash: debugView.run.schemaHash ?? null,
      planVersion: debugView.run.planVersion ?? 0,
      metadata: debugView.run.metadata ? redact(debugView.run.metadata) : null,
      envelope: redact(debugView.run.envelope),
      contextSnapshot: debugView.run.contextSnapshot ? redact(debugView.run.contextSnapshot) : null,
      createdAt: debugView.run.createdAt ?? null,
      updatedAt: debugView.run.updatedAt ?? null
    },
    output: debugView.output
      ? {
          planVersion: debugView.output.planVersion,
          status: debugView.output.status,
          schemaHash: debugView.output.schemaHash,
          recordedAt: debugView.output.recordedAt ?? null,
          updatedAt: debugView.output.updatedAt ?? null,
          output: redact(debugView.output.output),
          facets: debugView.output.facets ? redact(debugView.output.facets) : null,
          provenance: debugView.output.provenance ? redact(debugView.output.provenance) : null
        }
      : null,
    planVersions: debugView.snapshots.map((snapshot) => ({
      version: snapshot.planVersion,
      schemaHash: snapshot.schemaHash,
      pendingNodeIds: snapshot.pendingNodeIds,
      createdAt: snapshot.createdAt ?? null,
      updatedAt: snapshot.updatedAt ?? null,
      metadata: snapshot.metadata ? redact(snapshot.metadata) : null
    })),
    latestSnapshot: latestSnapshot
      ? {
          version: latestSnapshot.planVersion,
          schemaHash: latestSnapshot.schemaHash,
          pendingNodeIds: latestSnapshot.pendingNodeIds,
          createdAt: latestSnapshot.createdAt ?? null,
          updatedAt: latestSnapshot.updatedAt ?? null,
          facets: latestSnapshot.facets ? redact(latestSnapshot.facets) : null,
          snapshot: redact(latestSnapshot.snapshot)
        }
      : null,
    nodes: debugView.nodes.map((node) => ({
      nodeId: node.nodeId,
      capabilityId: node.capabilityId ?? null,
      label: node.label ?? null,
      status: node.status,
      context: node.context ? redact(node.context) : null,
      output: node.output ? redact(node.output) : null,
      error: node.error ? redact(node.error) : null,
      facets: node.facets ? redact(node.facets) : null,
      contracts: node.contracts ? redact(node.contracts) : null,
      provenance: node.provenance ? redact(node.provenance) : null,
      metadata: node.metadata ? redact(node.metadata) : null,
      rationale: node.rationale ? [...node.rationale] : null,
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null
    }))
  }
})
