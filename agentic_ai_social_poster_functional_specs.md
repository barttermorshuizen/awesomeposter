# Agentic AI Social Poster — Functional Specifications

## 1. Purpose
Define the functional requirements, use cases, and UX design for the Agentic AI Social Poster, covering manual and automated brief creation, AI-assisted content generation with 4-knob optimization, performance tracking, and bandit learning for continuous improvement.

## 2. Target Users
- **Digital Marketeer**: Manages client briefs, reviews AI-generated content, and approves publication.
- **Client Admin**: Maintains client profile details.
- **System Admin**: Oversees platform configuration and user management.

## 3. Core Features
### 3.1 Brief Management
- Create manual brief.
- Email intake to create draft briefs.
- Edit/update briefs.
- Approve briefs for AI processing.

### 3.2 Client Profile Management
- Manage objectives, audiences, tone of voice.
- **Primary Communication Language**: Support for Nederlands, UK English, US English, and Français.
- **Special Instructions**: Custom instructions for content generation (e.g., "Only use LinkedIn", "Always include 'Powered by AAA' above the hashtags").
- Store and manage brand assets.
- Define platform preferences.
- Configure client policies (voice, emoji usage, banned claims).

### 3.3 AI Content Generation Workflow (4-Knob System)
- Retrieve top-performing posts.
- Propose strategic knob settings:
  - **Format Type**: text, single_image, multi_image, document_pdf, video
  - **Hook Intensity**: 0.0-1.0 scale for opening line strength
  - **Expertise Depth**: 0.0-1.0 scale for practitioner-level specificity
  - **Structure**: length_level (0.0-1.0) and scan_density (0.0-1.0)
- Generate multiple variants based on knob settings.
- Rank variants by predicted performance.
- Approve and select final variants.

### 3.4 Publishing & Tracking
- Manual publishing/export.
- Automated publishing (future).
- Import metrics via CSV/API.
- Dashboard with performance data and knob effectiveness.

### 3.5 Inbox & Tasks
- Task list for pending actions.
- Email notifications for new tasks.
- Complete, snooze, or reassign tasks.

### 3.6 Performance Analytics & Bandit Learning
- Track knob settings vs. performance metrics.
- Log telemetry data for each post.
- Enable bandit algorithms for knob optimization.
- A/B testing framework for content variants.

## 4. Use Cases
### UC1: Create New Brief (Manual)
**Actor:** Digital Marketeer  
**Trigger:** User clicks "New Brief"  
**Steps:**
1. Fill in title, objective, audience, deadline, description.
2. Upload assets.
3. Save as draft or approve.

### UC2: Create Draft Brief via Email
**Actor:** Digital Marketeer, System  
**Trigger:** Marketeer forwards email to `socialposter@moreawesome.co` or labels it.  
**Steps:**
1. Email ingested by Mailgun webhook.
2. System parses content and attachments.
3. Draft brief created.
4. Marketeer notified to refine.

### UC3: Update Existing Brief
**Actor:** Digital Marketeer  
**Trigger:** User opens draft brief.  
**Steps:**
1. Edit title, objective, audience, deadline, description, assets.
2. Save changes.

### UC4: Approve Brief
**Actor:** Digital Marketeer  
**Trigger:** User clicks "Approve."  
**Steps:**
1. System runs readiness checklist.
2. Status changes to "approved."
3. AI workflow initiated with 4-knob optimization.

### UC5: Select Variants
**Actor:** Digital Marketeer  
**Trigger:** Task "Select Variants" appears in Inbox.  
**Steps:**
1. Review ranked variants with knob settings displayed.
2. Select 1–3 variants.
3. Choose publish method.
4. Confirm selection.

### UC6: Create New Client
**Actor:** Client Admin, Digital Marketeer  
**Trigger:** User clicks "New Client" from Clients or quick create.  
**Steps:**
1. Enter client name, industry, and website.
2. Select primary communication language (Nederlands, UK English, US English, or Français).
3. Configure tone of voice (preset + custom guidelines) and objectives/audiences.
4. Select platform preferences (e.g., LinkedIn) and defaults.

### UC7: Generate Language-Specific Content
**Actor:** Digital Marketeer, System  
**Trigger:** AI workflow generates content for a client brief.  
**Steps:**
1. System retrieves client's primary communication language from profile.
2. Copywriter agent generates content in the specified language.
3. Content maintains cultural context and language-specific nuances.
4. Digital Marketeer reviews language-appropriate content variants.

### UC8: Delete Client
**Actor:** Client Admin, Digital Marketeer  
**Trigger:** User clicks "Delete" from client actions menu.  
**Steps:**
1. System displays confirmation dialog: "Are you sure you want to delete [Client Name]? This action cannot be undone and will permanently remove all client data including briefs, assets, and related content."
2. User can either:
   - Click "Cancel" to abort deletion
   - Click "Delete" to confirm deletion
3. If confirmed, system:
   - Deletes all client-related data from database (cascade deletes)
   - Removes all client assets from R2 storage
   - Cleans up any related temporary files
   - Redirects to clients list with success message
4. If user cancels, dialog closes and no action is taken.

### UC9: Delete Brief
**Actor:** Digital Marketeer  
**Trigger:** User clicks "Delete" from brief actions menu.  
**Steps:**
1. System displays confirmation dialog: "Are you sure you want to delete [Brief Title]? This action cannot be undone and will permanently remove the brief and all associated data including assets and generated content."
2. User can either:
   - Click "Cancel" to abort deletion
   - Click "Delete" to confirm deletion
3. If confirmed, system:
   - Deletes brief data from database (cascade deletes)
   - Removes all brief-related assets from R2 storage
   - Cleans up any generated content variants
   - Cancels any pending AI tasks for this brief
   - Redirects to briefs list with success message
4. If user cancels, dialog closes and no action is taken.

### UC10: Analyze Knob Performance
**Actor:** Digital Marketeer  
**Trigger:** User views performance dashboard or selects post for analysis.  
**Steps:**
1. System displays knob settings used for the post.
2. Show performance metrics (impressions, engagement, see more expands).
3. Compare with historical performance for similar knob combinations.
4. Suggest knob adjustments for future posts.

### UC11: Configure Bandit Learning
**Actor:** System Admin  
**Trigger:** User accesses system settings or performance thresholds are met.  
**Steps:**
1. Enable/disable bandit learning algorithms.
2. Configure reward functions (engagement rate, see more expands, etc.).
3. Set exploration vs. exploitation parameters.
4. Define knob optimization priorities.

## 5. UX Design
### 5.1 Navigation
- **Sidebar:** Dashboard, Briefs, Inbox, Clients, Assets, Settings, Analytics.
- **Top bar:** Search, quick create, user menu.

### 5.2 Key Screens
- **Dashboard:** Metrics tiles, activity feed, shortcuts, knob performance insights.
- **Briefs:** Table with filters, row/bulk actions, knob settings display.
- **Inbox:** Task-focused view with filters.
- **Clients:** List/detail with profile data and policy settings.
- **Assets:** Library with filters and search.
- **Analytics:** Knob effectiveness, performance trends, A/B test results.

### 5.3 Patterns & Components
- Reusable tables & filters.
- Detail views with side panels.
- Consistent modals for approvals and confirmations.
- Notification toasts.
- Knob sliders and format type selectors.
- Performance visualization charts.

### 5.4 Responsive Design
- Desktop: Full sidebar.
- Tablet: Collapsible sidebar.
- Mobile: Bottom nav bar.

## 6. Non-Functional Requirements
- Draft briefs ready within 30s of ingestion.
- Mobile-friendly UI.
- Role-based access control.
- Provider-agnostic email intake.
- Real-time knob performance tracking.
- Bandit learning updates within 24 hours of new data.

## 7. Assumptions & Constraints
- LinkedIn API limitations.
- GPT-5 dependency for AI generation.
- Automated publishing starts with LinkedIn only.
- Knob optimization requires minimum 10 posts per client for statistical significance.

## 8. Roadmap
- Phase 1: Manual publishing, CSV import, 4-knob system implementation.
- Phase 2: Automated publishing APIs, basic bandit learning.
- Phase 3: Advanced bandit algorithms, multi-platform optimization.

---

# Agent Specifications

## Digital Marketeer Agent

### Purpose
The **Digital Marketeer** agent is responsible for interpreting client briefs and objectives, analyzing available data (analytics, previous posts, tone of voice, constraints), **analyzing available assets to determine achievable formats**, and setting the strategic parameters ("knobs") for content generation. It also critiques and ranks generated variants against performance heuristics and learns from performance data to optimize future knob settings.

### Inputs
- **Objective:** Campaign goal (e.g., lead generation, awareness).
- **Client Profile:** Audience definitions, tone of voice, brand guidelines, platform preferences, client policies.
- **Brief:** Campaign-specific details, assets, deadlines.
- **Assets:** Available images, documents, videos, and their metadata (type, size, format).
- **Analytics Summary:** CSV/API imports with top-performing posts, timing insights, CTR data, see more expands.
- **Constraints:** Legal restrictions, banned phrases, compliance rules.
- **Historical Performance:** Previous knob settings and their performance outcomes.

### Responsibilities
1. **Asset Analysis & Format Feasibility**
   - Analyze available assets (images, documents, videos) for each brief
   - Assess asset quality, quantity, and suitability for different format types
   - **CRITICAL: Determine achievable format types based ONLY on available assets**
   - **NEVER recommend formats that cannot be executed with current assets**
   - Provide asset recommendations for optimal content creation
   - Validate that chosen format type can be properly executed with available assets
   - **Override brief requests when assets are insufficient for requested format**

2. **Strategy Formation & Knob Setting**
   - Select target platforms based on asset capabilities and client preferences
   - Set the 4 primary knobs:
     - **Format Type**: Choose optimal content container based on **available assets and their capabilities**
     - **Hook Intensity**: Set opening line strength (0.0-1.0) based on client voice and objective
     - **Expertise Depth**: Determine practitioner-level specificity (0.0-1.0)
     - **Structure**: Set length_level and scan_density for optimal readability
   - Define post structure (e.g., hook → insight → CTA).
   - Suggest themes, hashtags, and angles.
   - Provide one-sentence strategy objective.

3. **Draft Evaluation**
   - Score variants against readability, clarity, objective fit, brand risk, and platform compliance.
   - **Validate that content properly utilizes the available assets**
   - Rank or filter variants based on predicted performance.
   - Provide revision instructions to the Copywriter agent if scores fall below thresholds.
   - Consider knob effectiveness in scoring.

4. **Publishing Preparation**
   - Suggest best publishing windows per platform.
   - Generate campaign UTM parameters.
   - Output a rationale summary for variant selection.

5. **Performance Learning**
   - Analyze post performance data.
   - Correlate knob settings with engagement metrics.
   - Update knob strategies based on performance insights.
   - Enable bandit learning for continuous optimization.

### Outputs
- **Asset Analysis Report:** Assessment of available assets and achievable formats
- **Knob Payload:** Complete JSON object with all 4 knobs, assets, and client policy.
- **Strategy Package:** Angles, structure, themes, hashtags, strategy objective.
- **Critiques:** Ranked scores, comments, revision instructions.
- **Publishing Data:** Suggested schedule, UTMs, compliance checks.
- **Learning Insights:** Knob performance analysis and optimization recommendations.

---

## Copywriter Agent

### Purpose
The **Copywriter** agent is responsible for generating and refining post drafts according to the strategy and knobs provided by the Digital Marketeer agent. It ensures alignment with tone of voice, platform requirements, client brand guidelines, and renders content according to the specific knob settings.

### Inputs
- **Knob Payload:** Complete knob settings, assets, and client policy from Digital Marketeer.
- **Strategy Package:** Post structure, themes, hashtags, strategy objective.
- **Tone of Voice:** Client-specific writing style and restrictions.
- **Constraints:** Brand/legal guardrails, banned words, industry-specific compliance rules.
- **Revision Instructions:** Feedback from the Digital Marketeer agent.

### Responsibilities
1. **Draft Generation (Knob-Aware)**
   - Produce multiple post variants per platform based on knob settings.
   - **Format Type Rendering:**
     - text: Prioritize skimmable structure; no asset placeholders.
     - single_image: Reference the image in copy (contextual caption).
     - multi_image: Structure as steps or comparisons (slide-like sequencing).
     - document_pdf: Write as slide headlines + punchy bullets per slide (≤8 slides).
     - video: Hook + 3 key points + CTA.
   - **Hook Intensity Rendering:**
     - 0.0-0.3: Neutral, descriptive opener. No controversy.
     - 0.4-0.7: Specific pain/benefit + light tension.
     - 0.8-1.0: Bold claims, contrarian statements, quantified results.
   - **Expertise Depth Rendering:**
     - 0.0-0.3: Broad insight, minimal jargon, 1-2 tips.
     - 0.4-0.7: Actionable steps with light jargon, 2-4 tips.
     - 0.8-1.0: Deep practitioner playbook; show method, metrics, pitfalls.
   - **Structure Rendering:**
     - Compute target character budget from length_level.
     - Use 3-6 sections with headers when scan_density ≥ 0.7.
     - Ensure total characters ≤ 2900.
   - Provide CTA wording and headline variations; the opening hook must be embedded in the main copy (first line), not as separate options.
   - Create alt-text suggestions for assets.
   - Respect platform character limits and formatting rules.

2. **Revision**
   - Incorporate critique and feedback from the Digital Marketeer agent.
   - Adjust knob-specific aspects as required.
   - Maintain knob compliance while improving quality.

3. **Finalization**
   - Deliver cleaned, platform-ready posts.
   - Ensure compliance with tone of voice and constraints.
   - Tag assets (image, video) with matching alt-text.
   - Return render metrics (lines count, avg line chars, total chars, framework included, metric count).

### Outputs
- **Post Variants:** JSON object with text, CTAs, hashtags, alt-text, character counts, used assets, sections count, hook line (derived from first line of `post`).
- **Refined Drafts:** Updated variants after critique.
- **Deliverable Package:** Final posts ready for publishing/export.
- **Render Metrics:** Content analysis data for telemetry and learning.

---

## 4-Knob System Details

### Format Type
- **text**: Pure text posts, optimized for skimmability
- **single_image**: Single image with contextual caption
- **multi_image**: Multiple images with step-by-step or comparison structure
- **document_pdf**: Carousel format with slide headlines and bullet points
- **video**: Video content with hook, key points, and CTA

### Hook Intensity (0.0-1.0)
- **0.0-0.3**: Neutral, informational openers
- **0.4-0.7**: Specific benefits with light tension
- **0.8-1.0**: Bold claims, contrarian statements, quantified results

### Expertise Depth (0.0-1.0)
- **0.0-0.3**: Generalist insights and tips
- **0.4-0.7**: Actionable steps with moderate jargon
- **0.8-1.0**: Deep practitioner frameworks and methodologies

### Structure
- **length_level (0.0-1.0)**: Character budget from 300-2400 chars
- **scan_density (0.0-1.0)**: From paragraph blocks to bullet points and dividers

### Validation Rules
- Total characters ≤ 2900 (leaving room for hashtags)
- Hook intensity capped by client voice policy
- Format type must match available assets
- Claims with numbers require supporting evidence within first 3 lines

### Default Settings (Safe Baselines)
- format_type: document_pdf (if slides available) else multi_image else text
- hook_intensity: 0.65
- expertise_depth: 0.7
- structure: { length_level: 0.6, scan_density: 0.85 }

