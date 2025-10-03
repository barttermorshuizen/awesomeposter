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
   - Track ingestion + reviewer accuracy metrics for first 24 hours (Section 5.3). Hold debrief to capture early issues.

If any step fails, disable flag immediately and escalate to engineering.

### 2.1 Activation Checklist Template (Complete within 1 Business Day)
| Step | Owner | Target Window | Status |
| --- | --- | --- | --- |
| Confirm staging flag + smoke test | Platform Eng | Pilot Day 0 (AM) | ☐ |
| Share kickoff deck & run training | PM | Pilot Day 0 (PM) | ☐ |
| Toggle production client flag | Support | Pilot Day 1 09:00 | ☐ |
| Validate discovery navigation + sources tab | Pilot Reviewer | Pilot Day 1 10:00 | ☐ |
| Add seed source + verify SSE `source.created` | Pilot Reviewer + Support | Pilot Day 1 11:00 | ☐ |
| Confirm keyword set ≤20 entries & duplicates resolved | Marketing Ops | Pilot Day 1 13:00 | ☐ |
| Review telemetry dashboard (ingestion, accuracy ≥95%) | Support | Pilot Day 1 15:00 | ☐ |
| Post end-of-day status update in `#discovery-pilot` | PM | Pilot Day 1 17:00 | ☐ |

### 2.2 Source & Keyword Configuration Snapshot
- Ensure each pilot client has their baseline source list documented in `docs/prd/epic-discovery-client-source-config.md`.
- Keyword themes managed via the Discovery Sources view must:
  - Stay within the 20-keyword limit.
  - Use lowercase canonical form (see Story 2.2) and remove duplicates flagged inline.
  - Capture campaign notes in the keyword drawer for downstream scoring context.
- Record any exceptions (blocked domains, specialty feeds) in Appendix A for traceability.

### 2.3 Telemetry Kickoff Checks
- Verify telemetry stream for the client is active: SSE stream should emit `source.created` and `keyword.updated` within 60 seconds of changes.
- Validate ingestion success rate ≥95% and reviewer accuracy target ≥95% by running the "Pilot Quality" saved view (see Section 5.3).
- Capture screenshot of telemetry dashboard and attach to Day 1 status update for audit.

---

## 3. Daily Operator Workflow
| Task | Actor | Frequency | Notes |
| --- | --- | --- | --- |
| Review new briefs (`Spotted`) | Pilot reviewer | Daily | Target <2 min per item; leave note on decisions. |
| Manage sources/keywords | Marketing operator | Weekly | Duplicate detection warnings require follow-up within 2 business days; confirm keyword count ≤20. |
| Check telemetry dashboard | Support | Daily | Watch ingestion success rate (>95%), reviewer accuracy ≥95%, and SSE uptime. |
| Submit feedback form | Pilot reviewer | Weekly | Use shared form; responses routed to PM + engineering. |

Escalate anomalies via Slack channel `#discovery-pilot` with timestamps and screenshots.

### 3.1 Source Entry Procedure
Operators must follow this protocol when onboarding HTTP sources for a client:

1. Navigate to **Clients → ⋮ → Discovery Sources** for the target client.
2. Paste the candidate URL. The form immediately validates:
   - Only `http://` or `https://` protocols are accepted; other schemes are blocked.
   - RSS feeds (`*.xml`, `*.rss`, `/feed`) and YouTube channels/playlists are auto-detected and labelled.
   - Canonicalization removes tracking parameters; confirm the summary chip matches expectations before saving.
3. Resolve any inline duplicate warning before submitting. Duplicates are detected case-insensitively using canonical identifiers (e.g., YouTube channel ID or RSS URL).
4. Add optional operator notes (why the source matters, expected cadence) for hand-off to support.
5. Submit. The UI performs an optimistic add; if persistence fails the entry rolls back and a toast/alert surfaces the server error.
6. After success, confirm support receives the `source-created` SSE event with payload `{ id, clientId, sourceType, url }` (visible in telemetry stream or developer console during pilot).

If a source repeatedly fails validation, escalate to backend owners with the canonical URL and any error messages.

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
- Reviewer accuracy (goal ≥95%; see Section 5.3)
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

### 5.3 Accuracy Validation Walkthrough (≥95%)
1. Open the telemetry dashboard saved view **Pilot Quality** (documented in `docs/prd/epic-discovery-telemetry-reporting.md`).
2. Filter to the pilot client and set the time window to "Past 24 hours".
3. Review the "Reviewer Accuracy" widget:
   - If ≥95%, capture a screenshot and attach to the Day 1 status update.
   - If <95%, annotate the variance in Appendix A and escalate to Support Lead for follow-up within 4 hours.
4. Cross-check the "Flag State" audit trail to ensure the toggle event is recorded with actor + reason.
5. Export the CSV snapshot and archive it under `docs/internal/pilot-reports/<week>-day1.csv` for audit.

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

---

## 10. Stakeholder Feedback & Sign-off
- **2025-03-29 Support Review (Nina K.)**: Requested explicit SSE verification step and Day-1 accuracy target—captured in Sections 2.3 and 5.3.
- **2025-03-30 Ops Review (Marco D.)**: Added keyword limit reminder plus checklist table for one-business-day handoff (Section 2.1).
- **Approval**: Support Lead and Ops Lead sign-off recorded in `docs/internal/contact-sheet.md` once the pilot cohort is onboarded.

Revisit this section after each cohort to log additional feedback items and document follow-up actions.
