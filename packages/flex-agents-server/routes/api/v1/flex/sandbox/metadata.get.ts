import {
  TaskEnvelopeSchema,
  getFacetCatalog,
  type FacetDefinition,
  type TaskEnvelope
} from '@awesomeposter/shared'
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'pathe'
import { getHeader, setHeader } from 'h3'
import {
  resolveFlexTemplateDir,
  requireFlexSandboxEnabled
} from '../../../../../src/utils/flex-sandbox'

type FacetDescriptor = Pick<FacetDefinition, 'name' | 'title' | 'description' | 'schema' | 'semantics' | 'metadata'>

type CapabilityCatalogEntry = {
  id: string
  name: string
  description: string
  prompt?: {
    instructions: string
    toolsAllowlist: string[]
  } | null
}

type TemplateDescriptor = {
  id: string
  filename: string
  modifiedAt: string
  size: number
  envelope?: TaskEnvelope
  error?: string
}

function mapFacetDefinition(definition: FacetDefinition): FacetDescriptor {
  const { name, title, description, schema, semantics, metadata } = definition
  return {
    name,
    title,
    description,
    schema,
    semantics,
    ...(metadata ? { metadata } : {})
  }
}

async function loadTemplates(): Promise<TemplateDescriptor[]> {
  const dir = resolveFlexTemplateDir()
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    const templates: TemplateDescriptor[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      if (!entry.name.startsWith('flex-') || !entry.name.endsWith('.json')) continue
      const fullPath = join(dir, entry.name)
      try {
        const [raw, info] = await Promise.all([readFile(fullPath, 'utf8'), stat(fullPath)])
        const id = entry.name.replace(/^flex-/, '').replace(/\.json$/, '')
        const parsed = TaskEnvelopeSchema.safeParse(JSON.parse(raw))
        if (parsed.success) {
          templates.push({
            id,
            filename: entry.name,
            modifiedAt: info.mtime.toISOString(),
            size: info.size,
            envelope: parsed.data
          })
        } else {
          templates.push({
            id,
            filename: entry.name,
            modifiedAt: info.mtime.toISOString(),
            size: info.size,
            error: parsed.error.issues.map((issue) => issue.message).join('; ')
          })
        }
      } catch (err: any) {
        templates.push({
          id: entry.name.replace(/^flex-/, '').replace(/\.json$/, ''),
          filename: entry.name,
          modifiedAt: new Date().toISOString(),
          size: 0,
          error: err instanceof Error ? err.message : 'Failed to read template'
        })
      }
    }
    return templates
  } catch (err: any) {
    if (err && err.code === 'ENOENT') {
      return []
    }
    throw err
  }
}

export default defineEventHandler(async (event) => {
  const origin = getHeader(event, 'origin')
  if (origin) {
    setHeader(event, 'Vary', 'Origin')
    setHeader(event, 'Access-Control-Allow-Origin', origin)
    setHeader(event, 'Access-Control-Allow-Credentials', 'true')
  }
  setHeader(event, 'Access-Control-Allow-Headers', 'accept,authorization,content-type')
  setHeader(event, 'Access-Control-Allow-Methods', 'GET,OPTIONS')

  requireFlexSandboxEnabled()

  const [{ getFlexCapabilityRegistryService }, agentsContainer] = await Promise.all([
    import('../../../../../src/services/flex-capability-registry'),
    import('../../../../../src/services/agents-container')
  ])
  const { getCapabilityRegistry, resolveCapabilityPrompt } = agentsContainer

  const facetCatalog = getFacetCatalog()
  const registry = getFlexCapabilityRegistryService()

  const [facets, snapshot, templates] = await Promise.all([
    Promise.resolve(facetCatalog.list().map(mapFacetDefinition)),
    registry.getSnapshot(),
    loadTemplates()
  ])

  const capabilityCatalog: CapabilityCatalogEntry[] = getCapabilityRegistry().map((entry) => {
    const prompt = resolveCapabilityPrompt(entry.id)
    return {
      id: entry.id,
      name: entry.name,
      description: entry.description,
      ...(prompt ? { prompt } : {})
    }
  })

  return {
    generatedAt: new Date().toISOString(),
    facets,
    templates,
    capabilityCatalog,
    capabilities: {
      active: snapshot.active.map((record) => ({ ...record })),
      all: snapshot.all.map((record) => ({ ...record }))
    }
  }
})
