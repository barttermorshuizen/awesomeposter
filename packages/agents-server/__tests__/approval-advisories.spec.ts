// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  evaluateStrategyApprovalAdvisory,
  evaluateContentApprovalAdvisory,
  evaluateQaApprovalAdvisory,
  resolveHitlPolicy
} from '../src/services/approval-advisories'

import type { AgentRunRequest } from '@awesomeposter/shared'

describe('approval advisory heuristics', () => {
  describe('strategy advisories', () => {
    it('flags IPO objectives for legal review', () => {
      const advisory = evaluateStrategyApprovalAdvisory('Plan IPO launch messaging', {
        clientName: 'Acme Corp',
        audience: 'Investors',
        tone: 'Formal',
        hooks: ['A bold move for growth'],
        cta: 'Join the investor webinar'
      })
      expect(advisory).toBeTruthy()
      expect(advisory?.severity).toBe('block')
      expect(advisory?.suggestedRoles).toContain('legal')
      expect(advisory?.evidenceRefs).toContain('objective')
    })

    it('warns when required writer brief fields are missing', () => {
      const advisory = evaluateStrategyApprovalAdvisory('General update', {
        clientName: 'Acme',
        audience: '',
        tone: '',
        hooks: [],
        cta: ''
      })
      expect(advisory).toBeTruthy()
      expect(advisory?.severity).toBe('warn')
      expect(advisory?.reason).toMatch(/missing required fields/i)
    })
  })

  describe('content advisories', () => {
    it('blocks drafts that promise guaranteed returns and include placeholders', () => {
      const advisory = evaluateContentApprovalAdvisory('This IPO guarantees 100% returns for every investor. {{CTA}}')
      expect(advisory).toBeTruthy()
      expect(advisory?.severity).toBe('block')
      expect(advisory?.autoEscalate).toBe(true)
      expect(advisory?.suggestedRoles).toContain('legal')
    })
  })

  describe('qa advisories', () => {
    it('converts non-compliant QA results into a block advisory', () => {
      const advisory = evaluateQaApprovalAdvisory({
        compliance: false,
        brandRisk: 0.62,
        composite: 0.6,
        contentRecommendations: ['Needs legal review before publishing']
      })
      expect(advisory).toBeTruthy()
      expect(advisory?.severity).toBe('block')
      expect(advisory?.suggestedRoles).toContain('compliance')
      expect(advisory?.evidenceRefs).toContain('qa.brandRisk')
    })
  })

  describe('policy resolution', () => {
    it('merges policy overrides from request options', () => {
      const req = {
        mode: 'app',
        objective: 'Test',
        options: {
          hitlPolicy: {
            content: {
              highRiskPhrases: ['exclusive scoop']
            }
          }
        }
      } as AgentRunRequest
      const policy = resolveHitlPolicy(req)
      expect(policy.content?.highRiskPhrases).toContain('exclusive scoop')
      expect(policy.strategy?.blockKeywords).toContain('ipo')
    })
  })
})
