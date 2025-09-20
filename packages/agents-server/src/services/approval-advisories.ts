import type {
  AgentRunRequest,
  ApprovalAdvisory,
  ApprovalReviewerRole,
  ApprovalSeverity
} from '@awesomeposter/shared'

export type StrategyPolicy = {
  blockKeywords?: string[]
  warnKeywords?: string[]
  requiredFields?: string[]
  requireHumanOnMissingBrief?: boolean
}

export type ContentPolicy = {
  highRiskPhrases?: string[]
  aggressivePromises?: string[]
  placeholderSignals?: string[]
}

export type QaPolicy = {
  convertComplianceFailure?: boolean
  brandRiskThreshold?: number
  compositeThreshold?: number
  escalateRecommendationKeywords?: string[]
  rejectionBehavior?: 'replan' | 'finalize'
}

export type HitlPolicy = {
  strategy?: StrategyPolicy
  content?: ContentPolicy
  qa?: QaPolicy
  rejectionBehavior?: 'replan' | 'finalize'
}

type AdvisoryIssue = {
  severity: ApprovalSeverity
  reason: string
  roles?: ApprovalReviewerRole[]
  evidence?: string[]
  autoEscalate?: boolean
}

const SEVERITY_ORDER: ApprovalSeverity[] = ['info', 'warn', 'block']
const SEVERITY_RANK: Record<ApprovalSeverity, number> = {
  info: 0,
  warn: 1,
  block: 2
}

const DEFAULT_POLICY: Required<HitlPolicy> = {
  strategy: {
    blockKeywords: [
      'ipo',
      'initial public offering',
      'merger',
      'acquisition',
      'earnings release',
      'securities',
      'regulator',
      'layoff',
      'lawsuit',
      'litigation',
      'settlement'
    ],
    warnKeywords: ['financial guidance', 'earnings call', 'restructuring', 'policy change'],
    requiredFields: ['clientName', 'audience', 'tone', 'hooks', 'cta'],
    requireHumanOnMissingBrief: true
  },
  content: {
    highRiskPhrases: [
      'investment advice',
      'financial advice',
      'insider tip',
      'cure',
      'diagnose',
      'treat',
      'prevent',
      '10x returns',
      'risk-free',
      'get rich'
    ],
    aggressivePromises: ['100%', 'guarantee', 'guaranteed', 'no risk', 'never', 'always', 'proven'],
    placeholderSignals: ['{{', '[[', '<<', 'tbd', 'lorem ipsum', 'placeholder']
  },
  qa: {
    convertComplianceFailure: true,
    brandRiskThreshold: 0.25,
    compositeThreshold: 0.75,
    escalateRecommendationKeywords: ['legal review', 'manual approval', 'policy exception', 'compliance review', 'escalate'],
    rejectionBehavior: 'replan'
  },
  rejectionBehavior: 'replan'
}

function cloneDefaultPolicy(): HitlPolicy {
  return {
    strategy: { ...DEFAULT_POLICY.strategy, blockKeywords: [...DEFAULT_POLICY.strategy.blockKeywords], warnKeywords: [...DEFAULT_POLICY.strategy.warnKeywords], requiredFields: [...DEFAULT_POLICY.strategy.requiredFields] },
    content: {
      ...DEFAULT_POLICY.content,
      highRiskPhrases: [...DEFAULT_POLICY.content.highRiskPhrases],
      aggressivePromises: [...DEFAULT_POLICY.content.aggressivePromises],
      placeholderSignals: [...DEFAULT_POLICY.content.placeholderSignals]
    },
    qa: {
      ...DEFAULT_POLICY.qa,
      escalateRecommendationKeywords: [...DEFAULT_POLICY.qa.escalateRecommendationKeywords]
    }
  }
}

function deepMergePolicy(base: any, override: any): any {
  if (!override || typeof override !== 'object') return base
  const result: any = Array.isArray(base) ? [...base] : { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) {
      result[key] = [...value]
    } else if (typeof value === 'object') {
      result[key] = deepMergePolicy(base && typeof base[key] === 'object' ? base[key] : {}, value)
    } else {
      result[key] = value
    }
  }
  return result
}

function pickPolicySource(source: unknown): Record<string, unknown> | undefined {
  if (!source || typeof source !== 'object') return undefined
  const obj = source as Record<string, unknown>
  if (obj.hitlPolicy && typeof obj.hitlPolicy === 'object') return obj.hitlPolicy as Record<string, unknown>
  if (obj.approvalPolicy && typeof obj.approvalPolicy === 'object') return obj.approvalPolicy as Record<string, unknown>
  return undefined
}

function uniq<T>(values: T[]): T[] {
  const set = new Set(values)
  return Array.from(set)
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false
  if (typeof value === 'string') return value.trim().length > 0
  if (Array.isArray(value)) return value.length > 0
  if (typeof value === 'object') return Object.keys(value as Record<string, unknown>).length > 0
  if (typeof value === 'number') return Number.isFinite(value)
  return true
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function buildPlaceholderPatterns(signals?: string[]): RegExp[] {
  const list = signals && signals.length > 0 ? signals : DEFAULT_POLICY.content.placeholderSignals
  const patterns: RegExp[] = []
  for (const signal of list) {
    const normalized = String(signal || '').toLowerCase()
    if (!normalized) continue
    if (normalized === '{{') {
      patterns.push(/\{\{[^}]+\}\}/)
    } else if (normalized === '[[') {
      patterns.push(/\[\[[^\]]+\]\]/)
    } else if (normalized === '<<') {
      patterns.push(/<<[^>]+>>/)
    } else if (normalized === 'tbd') {
      patterns.push(/\bTBD\b/i)
    } else if (normalized === 'lorem ipsum') {
      patterns.push(/lorem ipsum/i)
    } else {
      patterns.push(new RegExp(escapeRegExp(signal), 'i'))
    }
  }
  // Always include a generic placeholder catch-all
  patterns.push(/\bTODO\b/i, /\bFIXME\b/i, /REVIEW REQUIRED/i)
  return uniq(patterns)
}

function detectAggressivePromises(text: string, tokens?: string[]): string[] {
  const lower = text.toLowerCase()
  const list = tokens && tokens.length > 0 ? tokens : DEFAULT_POLICY.content.aggressivePromises
  const matches: string[] = []
  for (const raw of list) {
    if (!raw) continue
    const sample = raw.toLowerCase()
    if (lower.includes(sample)) {
      matches.push(`"${raw}"`)
    }
  }
  const percentageHits = lower.match(/\b\d{2,}%\b/g)
  if (percentageHits && percentageHits.length > 0) {
    const contextTerms = ['return', 'returns', 'profit', 'profits', 'roi', 'growth', 'conversion', 'engagement']
    if (contextTerms.some((term) => lower.includes(term))) {
      matches.push('percentage-based guarantee')
    }
  }
  return uniq(matches)
}

function buildAdvisoryFromIssues(issues: AdvisoryIssue[]): ApprovalAdvisory | undefined {
  if (!issues || issues.length === 0) return undefined
  const severity = issues.reduce<ApprovalSeverity>((acc, cur) => {
    return SEVERITY_RANK[cur.severity] > SEVERITY_RANK[acc] ? cur.severity : acc
  }, issues[0].severity)
  const reason = issues
    .map((i) => i.reason.trim())
    .filter(Boolean)
    .join(' ')
    .trim()
  const evidenceRefs = uniq(issues.flatMap((i) => i.evidence || [])).filter(Boolean)
  const suggestedRoles = uniq(issues.flatMap((i) => i.roles || [])).filter(Boolean)
  const autoEscalate = issues.some((i) => i.autoEscalate || i.severity === 'block')
  return {
    severity,
    reason: reason || 'Human review advised.',
    evidenceRefs,
    suggestedRoles: suggestedRoles.length > 0 ? suggestedRoles : undefined,
    autoEscalate: autoEscalate ? true : undefined
  }
}

export function resolveHitlPolicy(req: AgentRunRequest): HitlPolicy {
  const resolved = cloneDefaultPolicy()
  const statePolicy = pickPolicySource((req as any)?.state)
  if (statePolicy) {
    if (statePolicy.strategy) resolved.strategy = deepMergePolicy(resolved.strategy, statePolicy.strategy)
    if (statePolicy.content) resolved.content = deepMergePolicy(resolved.content, statePolicy.content)
    if (statePolicy.qa) resolved.qa = deepMergePolicy(resolved.qa, statePolicy.qa)
    if (statePolicy.rejectionBehavior) resolved.rejectionBehavior = statePolicy.rejectionBehavior as any
  }
  const optionPolicy = pickPolicySource((req.options as any) || {})
  if (optionPolicy) {
    if (optionPolicy.strategy) resolved.strategy = deepMergePolicy(resolved.strategy, optionPolicy.strategy)
    if (optionPolicy.content) resolved.content = deepMergePolicy(resolved.content, optionPolicy.content)
    if (optionPolicy.qa) resolved.qa = deepMergePolicy(resolved.qa, optionPolicy.qa)
    if (optionPolicy.rejectionBehavior) resolved.rejectionBehavior = optionPolicy.rejectionBehavior as any
  }
  return resolved
}

export function evaluateStrategyApprovalAdvisory(
  objective: string,
  writerBrief: unknown,
  policy?: StrategyPolicy
): ApprovalAdvisory | undefined {
  const effective = policy || DEFAULT_POLICY.strategy
  const issues: AdvisoryIssue[] = []
  const lowerObjective = String(objective || '').toLowerCase()

  for (const keyword of effective.blockKeywords || []) {
    if (!keyword) continue
    if (lowerObjective.includes(keyword.toLowerCase())) {
      issues.push({
        severity: 'block',
        reason: `Objective references regulated topic "${keyword}". Manual approval required before publishing.`,
        roles: ['legal', 'executive'],
        evidence: ['objective'],
        autoEscalate: true
      })
      break
    }
  }

  if (!issues.some((i) => i.severity === 'block')) {
    for (const keyword of effective.warnKeywords || []) {
      if (!keyword) continue
      if (lowerObjective.includes(keyword.toLowerCase())) {
        issues.push({
          severity: 'warn',
          reason: `Objective mentions sensitive topic "${keyword}". Confirm strategy manually.`,
          roles: ['marketing_manager'],
          evidence: ['objective']
        })
        break
      }
    }
  }

  if (effective.requireHumanOnMissingBrief !== false) {
    if (!writerBrief || typeof writerBrief !== 'object') {
      issues.push({
        severity: 'warn',
        reason: 'Strategy output did not include a usable writer brief. Human review recommended.',
        roles: ['marketing_manager'],
        evidence: ['writerBrief']
      })
    } else {
      const missing = (effective.requiredFields || []).filter((field) => !hasMeaningfulValue((writerBrief as any)[field]))
      if (missing.length > 0) {
        issues.push({
          severity: 'warn',
          reason: `Writer brief missing required fields: ${missing.join(', ')}.`,
          roles: ['marketing_manager'],
          evidence: missing.map((field) => `writerBrief.${field}`)
        })
      }
    }
  }

  return buildAdvisoryFromIssues(issues)
}

export function evaluateContentApprovalAdvisory(
  draftText: string | undefined,
  policy?: ContentPolicy
): ApprovalAdvisory | undefined {
  const text = String(draftText || '').trim()
  if (!text) return undefined
  const lower = text.toLowerCase()
  const effective = policy || DEFAULT_POLICY.content
  const issues: AdvisoryIssue[] = []

  for (const phrase of effective.highRiskPhrases || []) {
    if (!phrase) continue
    if (lower.includes(phrase.toLowerCase())) {
      issues.push({
        severity: 'block',
        reason: `Draft contains high-risk claim "${phrase}" that requires legal approval.`,
        roles: ['legal', 'compliance'],
        evidence: ['draftText'],
        autoEscalate: true
      })
      break
    }
  }

  if (!issues.some((i) => i.severity === 'block')) {
    const aggressive = detectAggressivePromises(lower, effective.aggressivePromises)
    if (aggressive.length > 0) {
      issues.push({
        severity: 'block',
        reason: `Draft promises ${aggressive.join(', ')}. Escalate for legal review.`,
        roles: ['legal', 'compliance'],
        evidence: ['draftText'],
        autoEscalate: true
      })
    }
  }

  const placeholderPatterns = buildPlaceholderPatterns(effective.placeholderSignals)
  if (placeholderPatterns.some((re) => re.test(text))) {
    issues.push({
      severity: issues.some((i) => i.severity === 'block') ? 'block' : 'warn',
      reason: 'Draft contains unresolved placeholder text that requires manual editing.',
      roles: ['marketing_manager'],
      evidence: ['draftText']
    })
  }

  return buildAdvisoryFromIssues(issues)
}

export function evaluateQaApprovalAdvisory(
  qaResult: unknown,
  policy?: QaPolicy
): ApprovalAdvisory | undefined {
  if (!qaResult || typeof qaResult !== 'object') return undefined
  const qa = qaResult as Record<string, unknown>
  const effective = policy || DEFAULT_POLICY.qa
  const issues: AdvisoryIssue[] = []

  const compliance = typeof qa.compliance === 'boolean' ? (qa.compliance as boolean) : undefined
  const brandRisk = typeof qa.brandRisk === 'number' ? (qa.brandRisk as number) : undefined
  const composite = typeof qa.composite === 'number' ? (qa.composite as number) : undefined

  if (effective.convertComplianceFailure !== false && compliance === false) {
    issues.push({
      severity: 'block',
      reason: 'QA marked the draft as non-compliant. Require human approval before publishing.',
      roles: ['compliance', 'legal'],
      evidence: ['qa.compliance'],
      autoEscalate: true
    })
  }

  if (typeof brandRisk === 'number' && typeof effective.brandRiskThreshold === 'number' && brandRisk > effective.brandRiskThreshold) {
    const severity: ApprovalSeverity = brandRisk > effective.brandRiskThreshold + 0.15 ? 'block' : 'warn'
    issues.push({
      severity,
      reason: `QA brand risk ${brandRisk.toFixed(2)} exceeds policy threshold ${effective.brandRiskThreshold.toFixed(2)}.`,
      roles: ['legal', 'compliance'],
      evidence: ['qa.brandRisk'],
      autoEscalate: severity === 'block'
    })
  }

  if (typeof composite === 'number' && typeof effective.compositeThreshold === 'number' && composite < effective.compositeThreshold) {
    issues.push({
      severity: 'warn',
      reason: `QA composite score ${composite.toFixed(2)} is below target ${effective.compositeThreshold.toFixed(2)}.`,
      roles: ['marketing_manager'],
      evidence: ['qa.composite']
    })
  }

  const recommendations = Array.isArray(qa.contentRecommendations) ? qa.contentRecommendations : []
  const recKeywords = effective.escalateRecommendationKeywords && effective.escalateRecommendationKeywords.length > 0
    ? effective.escalateRecommendationKeywords
    : DEFAULT_POLICY.qa.escalateRecommendationKeywords
  const flagged = recommendations.find((rec) => {
    if (typeof rec !== 'string') return false
    const lower = rec.toLowerCase()
    return recKeywords.some((kw) => lower.includes(String(kw || '').toLowerCase()))
  })
  if (flagged) {
    issues.push({
      severity: 'warn',
      reason: `QA recommendation requests manual approval: "${flagged}".`,
      roles: ['compliance', 'marketing_manager'],
      evidence: ['qa.contentRecommendations']
    })
  }

  return buildAdvisoryFromIssues(issues)
}
