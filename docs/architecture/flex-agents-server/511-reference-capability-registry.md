# 5.11 Reference capability registry

| capabilityId | AgentType | kind | summary | inputTraits | inputContract | outputContract |
| :---- | :---- | :---- | :---- | :---- | :---- | :---- |
| strategist.SocialPosting | AI | structuring | Generates a strategic rationale and creative brief for social posts (e.g., new case, new employee). | Reasoning, Planning, Context extraction | company\_information, post\_context | creative\_brief, strategic\_rationale, handoff\_summary, feedback |
| strategist.Positioning | AI | structuring | Analyzes a competitive positioning and produces a clear value proposition with reasoning. | Analysis, Synthesis, Market Reasoning | positioning\_context, feedback | value\_canvas, positioning\_opportunities, positioning\_recommendation |
| copywriter.SocialpostDrafting | AI | execution | Drafts social post copy using strategist’s creative brief. | Writing, Tone adaptation, Channel adaptation, | company\_information, creative\_brief, handoff\_summary | post\_copy, handoff\_summary, feedback |
| copywriter.Messaging | AI | execution | Takes positioning and creates a messaging stack. | Copy Editing, Style Adaptation | positioning\_context, positioning\_recommendation, feedback | messaging\_stack, handoff\_summary |
| designer.VisualDesign | Human | execution | Creates visual assets for a post using strategists’ creative brief. | Visual design, Brand alignment | company\_information, creative\_brief, handoff\_summary, feedback | post\_visual, handoff\_summary, feedback |
| director.SocialPostingReview | Human | validation | Approves final post (copy \+ visuals), or provides feedback on rationale,visuals or copy. | Evaluation, Brand Consistency | post\_context, strategic\_rationale, post\_copy, post\_visual | post, feedback |
| director.PositioningReview | Human | validation | Approves positioning recommendation and messaging stack, or provides feedback on positioning or messaging stack | Evaluation, Brand strategy | positioning\_context, value\_canvas, positioning\_opportunities, positioning\_recommendation, messaging\_stack | positioning, feedback |

> Strategist, copywriter, and designer capabilities all output the shared `feedback` facet. When they deliver a revision, they must update the original entry (matching facet/path) so `resolution = "addressed"` (or revert to `open` if it still needs work), allowing replans and telemetry to see the current state without duplicate records.

**Marketing sandbox tagging**
- Every capability above publishes `metadata.catalogTags = ["marketing-agency", "sandbox"]` and `metadata.collection = "flex.marketing"` in its registration payload.
- Registry and sandbox clients can continue to consume the full payload; the Vue sandbox filters to the curated set by checking these tags without changing the transport contract.
