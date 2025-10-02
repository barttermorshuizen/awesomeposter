# Discovery Agent Pilot Onboarding & Operations Runbook

## Purpose
Give product, support, and pilot operators a clear checklist for enabling the discovery agent, collecting feedback, and escalating issues without engineering intervention.

## Audience
- Product Owner / PM leading the pilot
- Customer Success & Support partners
- Pilot reviewers and marketing operators

---

## 1. Pilot Preparation
### 1.1 Prerequisites
- ✅ `DISCOVERY_ENABLE` confirmed `false` in production prior to pilot.
- ✅ Feature flag tooling accessible (`pnpm run flags:list discovery` or admin UI).
- ✅ Operator accounts provisioned with AwesomePoster access.
- ✅ Training session scheduled (30 minutes) covering dashboard, source management, and feedback loop.
- ✅ Support contact rotation defined (see Section 6).

### 1.2 Required Materials
| Artifact | Location | Owner |
| --- | --- | --- |
| Source configuration guide | `docs/prd/epic-discovery-client-source-config.md` | PM + Frontend |
| Telemetry cheat sheet | `docs/prd/epic-discovery-telemetry-reporting.md` | Platform |

> Update this table before each pilot cohort; missing artifacts block launch.

---

## 2. Activation Checklist
1. **Confirm Staging Success**
   - Run ingestion + dashboard smoke test in staging with pilot client flag enabled.
   - Ensure SSE stream displays ingestion events within 2 minutes.
2. **Enable Client Flag**
   - Command: `pnpm run flags:set discovery --client <clientId> --enabled` (or toggle in admin UI).
   - Log change in release notes with timestamp, operator, client ID.
3. **Notify Operators**
   - Send kickoff email including: login link, feature overview, support contacts, rollout timeline, feedback expectations.
4. **Verify Access**
   - Operator logs in, confirms discovery navigation item visible, sources tab accessible.
   - Operator adds first test source; support verifies backend receives `source.created` event.
5. **Monitor 24-Hour Bake**
   - Track ingestion metrics for first 24 hours (Section 5). Hold debrief to capture early issues.

If any step fails, disable flag immediately and escalate to engineering.

---

## 3. Daily Operator Workflow
| Task | Actor | Frequency | Notes |
| --- | --- | --- | --- |
| Review new briefs (`Spotted`) | Pilot reviewer | Daily | Target <2 min per item; leave note on decisions. |
| Manage sources/keywords | Marketing operator | Weekly | Duplicate detection warnings require follow-up within 2 business days. |
| Check telemetry dashboard | Support | Daily | Watch ingestion success rate (>95%) and SSE uptime. |
| Submit feedback form | Pilot reviewer | Weekly | Use shared form; responses routed to PM + engineering. |

Escalate anomalies via Slack channel `#discovery-pilot` with timestamps and screenshots.

---

## 4. Issue Escalation Matrix
| Severity | Example | Immediate Action | SLA |
| --- | --- | --- | --- |
| SEV1 | Discovery routes erroring for all users | Disable feature flag, notify engineering on-call via PagerDuty | 15 min |
| SEV2 | Ingestion stalled for >6 hours | Collect `discovery_ingestion.log`, create Jira ticket `DISC-incident`, alert platform lead | 1 hour |
| SEV3 | Single source failing repeatedly | Log details in runbook appendix, assign to backend owner | 1 business day |
| SEV4 | UI feedback bug but work continues | Capture screenshot, add to feedback backlog | Next sprint |

Include incident summary in weekly pilot report.

---

## 5. Monitoring & Reporting
### 5.1 Metrics Dashboard
Track these daily (from telemetry view or Grafana):
- Pending ingestion jobs
- Ingestion success rate (goal ≥99%)
- Briefs promoted vs archived (per client)
- SSE uptime (goal ≥99%)
- Duplicate suppression rate (goal ≥90%)

### 5.2 Weekly Pilot Report Template
Send every Monday to stakeholders:
- Highlights & blockers
- Metric snapshot table (use above KPIs)
- Top 3 operator feedback points
- Risk updates and mitigation status
- Next week priorities

Store reports under `docs/internal/pilot-reports/<week>.md`.

---

## 6. Roles & Responsibilities
| Role | Primary | Backup | Responsibilities |
| --- | --- | --- | --- |
| Pilot Lead (PM) | Sarah | John | Coordinating pilot, approvals, reporting |
| Support Lead | TBD | Platform Eng | First responder, telemetry monitoring |
| Operator Champion | Client-side | CS Rep | Ensure adoption, gather feedback |
| Engineering On-call | Platform | Backend | Resolve SEV1/SEV2 incidents |

Maintain contact list in `docs/internal/contact-sheet.md`.

---

## 7. Training & Enablement
- Conduct live walkthrough of dashboard and source management; record session.
- Provide quick-start guide (2-page PDF) covering add source, manage briefs, report issues.
- Add microlearning: 5-minute Loom videos for each major workflow.
- Verify comprehension via short quiz (Google Form) before granting write access.

---

## 8. Pilot Exit Criteria
Pilot considered successful when:
- ≥80% of invited operators complete weekly workflow for 3 consecutive weeks.
- Precision ≥95% based on reviewer sampling.
- No SEV1/SEV2 incidents open.
- Runbook updated with lessons learnt and backlog items triaged.

After criteria met, schedule go/no-go meeting for broader rollout; include engineering, support, PM, and leadership.

---

## 9. Appendices
- **A. Incident Log**: use table format `[Date | Severity | Summary | Resolution | Follow-up owner]`.
- **B. FAQ**: populate with recurring operator questions (authentication, SSE disconnects, duplicate handling).
- **C. Glossary**: define key terms (`Spotted`, `Approved`, `Duplicate`, `Telemetry Event`).

Keep appendices in this file; update after each pilot milestone.
