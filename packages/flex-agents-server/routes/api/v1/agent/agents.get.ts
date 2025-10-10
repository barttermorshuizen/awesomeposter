export default defineEventHandler((event) => {
  // Route-level CORS for browsers
  const origin = getHeader(event, 'origin') || '*'
  setHeader(event, 'Vary', 'Origin')
  setHeader(event, 'Access-Control-Allow-Origin', origin)

  // Static discovery for now; aligns with TargetAgentIdEnum
  return {
    agents: [
      { id: 'orchestrator', label: 'Orchestrator', supports: ['app', 'chat'] },
      { id: 'strategy', label: 'Strategy Manager', supports: ['chat'] },
      { id: 'generator', label: 'Content Generator', supports: ['chat'] },
      { id: 'qa', label: 'Quality Assurance', supports: ['chat'] }
    ]
  }
})