# 5.11 Reference capability registry

| capabilityId | AgentType | summary | inputTraits | inputContract | outputContract |
| :---- | :---- | :---- | :---- | :---- | :---- |
| strategist.SocialPosting | AI | Generates a strategic rationale and creative brief for social posts (e.g., new case, new employee). | Reasoning, Planning, Context extraction | post\_context, company\_information | creative\_brief, strategic\_rationale, handoff\_summary |
| strategist.Positioning | AI | Analyzes a competitive positioning and produces a clear value proposition with reasoning. | Analysis, Synthesis, Market Reasoning | positioning\_context, feedback | value\_canvas, positioning\_opportunities, positioning\_recommendation |
| copywriter.SocialpostDrafting | AI | Drafts social post copy using strategist’s creative brief. | Writing, Tone adaptation, Channel adaptation, | creative\_brief,handoff\_summary, feedback | post\_copy,handoff\_summary |
| copywriter.Messaging | AI | Takes positioning and creates a messaging stack. | Copy Editing, Style Adaptation | positioning\_context, positioning\_recommendation, feedback | messaging\_stack, handoff\_summary |
| designer.VisualDesign | Human | Creates visual assets for a post using strategists’ creative brief. | Visual design, Brand alignment | creative\_brief, handoff\_summary, feedback | post\_visual,handoff\_summary |
| director.SocialPostingReview | Human | Approves final post (copy \+ visuals), or provides feedback on rationale,visuals or copy. | Evaluation, Brand Consistency | post\_context, strategic\_rationale, post\_copy, post\_visual | post, feedback |
| director.PositioningReview | Human | Approves positioning recommendation and messaging stack, or provides feedback on positioning or messaging stack | Evaluation, Brand strategy | positioning\_context, value\_canvas, positioning\_opportunities, positioning\_recommendation, messaging\_stack | positioning, feedback |

**Marketing sandbox tagging**
- Every capability above publishes `metadata.catalogTags = ["marketing-agency", "sandbox"]` and `metadata.collection = "flex.marketing"` in its registration payload.
- Registry and sandbox clients can continue to consume the full payload; the Vue sandbox filters to the curated set by checking these tags without changing the transport contract.
