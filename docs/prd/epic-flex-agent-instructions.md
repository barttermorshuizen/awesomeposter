#Epic: Agent Instruction & Template Routing Framework


Create a structured “agent instruction / template routing” layer so that orchestrator agents and specialist agents can reference workflow templates, operating instructions, and guardrails via lightweight, versioned artifacts (e.g. agent.md, plan_template.md). This enables more maintainable, self‑documented, and flexible orchestrations across both structured and ad hoc marketing use cases.

##Epic goal
	•	Reduce hard‑coded logic in planner / orchestrator for template selection or behavior routing
	•	Increase transparency: humans & agents can see the “instruction sheet” that governs how each agent should behave or route in different objective categories
	•	Support evolution: changing how an agent behaves or which templates it uses becomes a matter of updating its instruction file rather than deep code changes
	•	Enable hybrid flows: for structured tasks (e.g. social media posts), route to a plan template; for dynamic tasks (e.g. GTM strategy), allow fallback to free planning with guidance
	•	Improve maintainability, versioning, and governance of agent behaviors

##Acceptance Criteria / Success Metrics
	1.	The orchestrator is able to parse an agent.md (or equivalent instruction artifact) and load structured metadata: templates, fallback rules, capabilities, limitations, version.
	2.	Planner logic can use the instruction metadata to choose appropriate workflow templates (or fallback) based on the objective’s “category” or metadata.
	3.	Agents (non‑orchestrator) also have agent.md (or instruction files) that define operating checklists, guardrails, fallback rules, and constraints.
	4.	In a sample flow (e.g. social media posting, acquisition announcement), the orchestrator routes via the correct plan template based on the objective category, visible in execution trace.
	5.	If an instruction file is updated (version bump), new runs use the updated instructions, but in-flight runs preserve their original instruction version.
	6.	Mismatches (e.g. instruction references a non‑existent template) trigger lint / validation errors at deployment time.
	7.	Human UI (or debugging tools) can display for each agent the relevant instruction summary (e.g. which template was referenced, fallback logic).
	8.	Agents’ actual responses remain within the guardrails defined in their instruction files for a sample of representative runs.

##Scope / Inclusions
	•	Design schema / format for agent.md (frontmatter + structured metadata + prose)
	•	Parser / loader in orchestrator & planner
	•	Template registry / repository (e.g. plan_templates/) and linking from instruction files
	•	Planner extension: when objective arrives, consult agent instruction metadata for template matching
	•	Fallback / override logic for cases where instruction file is silent or invalid
	•	Versioning / compatibility support (tie runs to instruction file version)
	•	Linting / validation tooling to catch instruction/template mismatches
	•	UI / debugging support to surface instruction-derived logic
	•	Sample agent instruction files and templates for key marketing use cases (social, acquisition messaging, GTM plans)

##Out of Scope (for now)
	•	Automatically generating new plan templates purely from instruction files
	•	Complex conditional logic inside instruction files (only simple hints / priorities)
	•	Full migration of existing flows into the instruction-based routing immediately
	•	Heavy UI editing of agent.md within the product (initially these are code / repo artifacts)

##Dependencies
	•	Plan template repository / storage (e.g. a folder, CMS, or template registry)
	•	Capability registry / agent metadata system (so agent instruction metadata complements capability metadata)
	•	Planner & routing logic (ability to incorporate instruction metadata)
	•	Version & persistence system (tie runs to instruction versions)
	•	Lint / validation tooling

##Risks & Mitigations

###Risk	Mitigation
Instruction file diverges from actual agent behavior	Add automated tests / dummy runs to validate conformance; include assertion scaffolding in agent code
Hard to parse free-form prose, ambiguous instructions	Keep “decision‑critical parts” (template references, fallback rules) in structured metadata / frontmatter; limit complex logic in prose
Broken template references	Linting + validation at merge / deploy time to reject bad references
Version mismatch / drift	Embed version tag in instruction files; freeze version in in‑flight runs; support fallback to older version artifacts
Agents ignore guardrails in instructions	Instrument output validation and enforce guardrails at orchestration / validation layer

##Timeline / Phases (suggestion)
	1.	Phase 1: Define agent.md format & schema; build instruction parser; wire orchestrator to read metadata
	2.	Phase 2: Build basic routing: orchestrator selects workflow template based on objective category + agent instruction metadata
	3.	Phase 3: Add fallback logic & override support; versioning support
	4.	Phase 4: Migrate a few sample agents / flows to instruction-based routing; build validation / lint tooling
	5.	Phase 5: Expose instruction metadata in UI / debugging tools, monitor mismatches, refine rules

##Stakeholders / Roles
	•	Product / Strategy: define which objective categories & templates we need
	•	Architect / Backend: design the agent instruction format, parser, routing logic
	•	Orchestrator / Planner team: integrate instruction metadata into planner routing and fallback
	•	Agent teams / prompt engineers: write agent.md files and plan templates
	•	QA / Test: validate consistency & enforce guardrails
	•	UI / Devops: optionally expose instruction metadata in dashboards
