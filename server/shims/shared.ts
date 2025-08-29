// Minimal runtime/type shim for @awesomeposter/shared to enable local API dev without monorepo packages

// Types used across agent endpoints
export type AgentState = any
export type Draft = any
export type Asset = any
export type FormatType = any
export type KnobPayload = any

// Runtime constants referenced by orchestrator/agents
export const platformRules: Record<string, any> = {}
export const agentThresholds: Record<string, any> = {}
export const scoringWeights: Record<string, any> = {}

// Very small schema shims with parse passthrough
type SchemaLike<T = any> = { parse: (x: T) => T }
function passthroughSchema<T = any>(): SchemaLike<T> {
  return {
    parse: (x: T) => x
  }
}

// Schemas referenced by endpoints
export const createBriefSchema = passthroughSchema()
export const updateClientSchema = passthroughSchema()
export const createOrUpdateClientProfileSchema = passthroughSchema()