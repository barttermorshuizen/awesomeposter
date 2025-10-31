# 5.12 Reference facet catalog 

## Facet post\_context

**name**: post\_context

**title**: Post Context

**description**

Type-specific context for a social post (currently supports new\_case and new\_employee) plus shared narrative and optional attached assets (R2 URLs). Used by Strategist → Copywriter → Designer to plan, draft, and assemble a post.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["type", "data"],
  "properties": {
    "type": {
      "type": "string",
      "enum": ["new_case", "new_employee"],
      "description": "Post variant."
    },
    "data": {
      "type": "object",
      "description": "Contextual fields for the selected post type.",
      "properties": {
        "content_description": {
          "type": "string",
          "description": "Free-text narrative describing the core message."
        },
        "assets": {
alig          "type": "array",
          "description": "R2 asset URLs (images, PDFs, etc.).",
          "items": { "type": "string", "format": "uri" }
        },
        "case_url": {
          "type": "string",
          "description": "URL of the published customer case. (for type==new_case)"
        },
        "customer_name": {
          "type": "string",
          "description": "Customer/company name. (for type==new_case)"
        },
        "employee_name": {
          "type": "string",
          "description": "Full name of the new employee. (for type==new_employee)"
        },
        "role": {
          "type": "string",
          "description": "Job title or position. (for type==new_employee)"
        },
        "start_date": {
          "type": "string",
          "format": "date",
          "description": "Employee start date (optional). (for type==new_employee)"
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "type": "new_case",
      "data": {
        "content_description": "Acme Corp achieved a 32% efficiency boost using our platform.",
        "case_url": "https://companyx.com/cases/acme-efficiency",
        "customer_name": "Acme Corp",
        "assets": [
          "https://r2.companyx.com/social/acme_case_banner.jpg"
        ]
      }
    },
    {
      "type": "new_employee",
      "data": {
        "content_description": "Jane joins the design team after five years at DesignCo.",
        "employee_name": "Jane Doe",
        "role": "UX Designer",
        "start_date": "2025-10-01",
        "assets": [
          "https://r2.companyx.com/employees/jane_doe_portrait.jpg"
        ]
      }
    }
  ]
}
```

**semantics**

* type selects the reasoning frame inside Strategist.SocialPosting.  
* data.content\_description is the canonical short narrative  
* data.assets\[\] are source materials (R2 URLs)

**metadata**

* version: 1.0.0  
* direction: input  
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]

Here’s the facet definition for **creative\_brief**, formatted in the same markdown \+ schema structure you’re using.

## Facet creative\_brief

**name**: creative\_brief

**title**: Creative Brief

**description**

Structured summary of how a social post or campaign should be executed — the strategist’s distilled plan for creative direction. It provides downstream agents (copywriter, designer, reviewer) with the key message, audience focus, tone, and structure.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["core_message", "structure", "tone", "audience"],
  "properties": {
    "core_message": {
      "type": "string",
      "description": "The central message or idea the content should communicate."
    },
    "supporting_points": {
      "type": "array",
      "description": "Optional list of subpoints, stats, or proof points that support the core message.",
      "items": { "type": "string" }
    },
    "structure": {
      "type": "string",
      "description": "Recommended structure for the post, e.g., 'Problem → Solution → Result → CTA'."
    },
    "tone": {
      "type": "string",
      "description": "Desired voice or emotional tone (e.g., 'grateful', 'authoritative', 'playful')."
    },
    "audience": {
      "type": "string",
      "description": "Intended audience or persona (e.g., 'B2B buyers', 'new employees')."
    },
    "visual_guidelines": {
      "type": "object",
      "description": "High-level guidance for the visual execution of the post.",
      "properties": {
        "layout_type": {
          "type": "string",
          "enum": ["single_image", "carousel", "video", "animation", "none"],
          "description": "Recommended layout or post type."
        },
        "format": {
          "type": "string",
          "enum": ["square", "portrait", "landscape", "story"],
          "description": "Preferred aspect ratio or format."
        },
        "image_count": {
          "type": "integer",
          "minimum": 1,
          "description": "Suggested number of images or frames for carousels."
        },
        "design_notes": {
          "type": "string",
          "description": "Free-text notes for the designer (e.g., 'feature customer logo prominently')."
        }
      },
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "core_message": "Acme Corp achieved 32% higher production efficiency using our platform.",
      "supporting_points": [
        "Customer-first partnership",
        "Data-driven impact"
      ],
      "structure": "Problem → Solution → Result → CTA",
      "tone": "grateful",
      "audience": "Manufacturing operations leaders",
      "visual_guidelines": {
        "layout_type": "carousel",
        "format": "square",
        "image_count": 3,
        "design_notes": "Include before/after charts and customer logo on first frame."
      }
    }
  ]
}
```

**semantics**

**metadata**

* version: 1.0.0  
* direction: bidirectional  
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]

Got it — you want strategic\_rationale to serve as a simple, human- and model-readable text field that explains *why* a plan was made, without structure or nested fields.

Here’s the minimal, consistent facet definition in your schema format:

---

## Facet strategic\_rationale

**name**: strategic\_rationale

**title**: Strategic Rationale

**description**

Plain-text explanation of the reasoning behind a strategist’s recommendations or creative plan.

It captures context and intent so that reviewers understand *why* specific choices were made.

**schema** (JSON Schema fragment)

```
{
  "type": "string",
  "description": "Free-text explanation of the reasoning and intent behind a strategy or creative decision.",
  "examples": [
    "The goal is to reinforce credibility through real customer outcomes. A customer success post with measurable impact performs best for our audience."
  ]
}
```

**semantics**

* Treated as descriptive text, not machine-interpreted structure.

* Copied forward unchanged through downstream steps (copywriter, designer, director).

* Provides understanding for human review and audit and can  be supplied to customer alongside the post.

**metadata**
* version: 1.0.0 
* direction: bidirectional  
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]

Here’s the facet definition for **handoff\_summary**, following your simplified metadata convention.

---

## Facet handoff\_summary

**name**: handoff\_summary

**title**: Handoff Summary

**description**

A running textual log of decisions, notes, or key observations that each agent appends as work progresses through the task envelope. It provides continuity and traceability between capabilities in a chain.

**schema** (JSON Schema fragment)

```
{
  "type": "array",
  "description": "Ordered list of textual notes created by agents as work passes between capabilities.",
  "items": {
    "type": "string",
    "description": "A short free-text summary of what was produced, decided, or recommended in this step."
  },
  "examples": [
    [
      "Strategist: Created plan emphasizing measurable customer results.",
      "Copywriter: Drafted post highlighting 32% efficiency gain with a grateful tone.",
      "Designer: Selected banner image showing before/after production metrics."
    ]
  ]
}
```

**semantics**

* Each generating agent **appends** a new text entry summarizing its contribution.

* The array accumulates across all capability executions within the task envelope.

* Used for handover context, reasoning visibility, and audit trails.

* Human and AI agents can both write to it.

**metadata**
* version: 1.0.0 
* direction: input
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet company_information

**name**: company_information

**title**: Company Information

**description**

Canonical profile of a company, capturing core identity details, audience guidance, and brand assets that downstream agents reference for consistent positioning and execution.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["name", "brand_assets"],
  "properties": {
    "name": {
      "type": "string",
      "description": "Official company name."
    },
    "website": {
      "type": "string",
      "format": "uri",
      "description": "Primary website URL."
    },
    "industry": {
      "type": "string",
      "description": "Industry or sector the company operates in."
    },
    "tone_of_voice": {
      "type": "string",
      "description": "Preferred tone or voice guidelines."
    },
    "special_instructions": {
      "type": "string",
      "description": "Additional guidance or caveats for representing the company."
    },
    "audience_segments": {
      "type": "string",
      "description": "Target audience segments or personas."
    },
    "preferred_channels": {
      "type": "string",
      "description": "Preferred distribution or communication channels."
    },
    "brand_assets": {
      "type": "array",
      "description": "Canonical brand asset URLs (logos, templates, etc.).",
      "items": { "type": "string", "format": "uri" }
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "name": "Acme Analytics",
      "website": "https://acmeanalytics.io",
      "industry": "Industrial IoT",
      "tone_of_voice": "Authoritative but friendly",
      "special_instructions": "Always include certified partner badge.",
      "audience_segments": "Operations leaders in mid-market manufacturing",
      "preferred_channels": "LinkedIn, industry newsletters",
      "brand_assets": [
        "https://assets.acmeanalytics.io/logos/wordmark.svg",
        "https://assets.acmeanalytics.io/templates/presentation-template.pdf"
      ]
    }
  ]
}
```

**semantics**

* Provides brand guardrails and references required by strategist, copywriter, designer, and reviewer agents.

* Ensures tone, audience, and asset usage remain consistent across content variants.

* brand_assets values are resolvable URIs; downstream systems handle retrieval and caching.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet feedback

**name**: feedback

**title**: Feedback

**description**

Records comments, change requests, or revision notes tied to specific **facets**.

Each entry references the facet affected so the planner can map feedback to producing or consuming capabilities and decide what to recompute—without procedural hints.

**schema** (JSON Schema fragment)

```
{
  "type": "array",
  "description": "Feedback items associated with specific facets; used for targeted replanning or review.",
  "items": {
    "type": "object",
    "required": ["author", "facet", "message"],
    "properties": {
      "author": {
        "type": "string",
        "description": "Name or role of the person or agent giving feedback."
      },
      "facet": {
        "type": "string",
        "description": "Facet key this feedback relates to (e.g., 'post_copy', 'creative_brief', 'strategic_rationale')."
      },
      "path": {
        "type": "string",
        "description": "Optional JSON pointer within the facet (e.g., '/headline')."
      },
      "message": {
        "type": "string",
        "description": "Feedback text or change request."
      },
      "note": {
        "type": "string",
        "description": "Optional note from the agent who acted on the feedback (e.g., 'adjusted headline')."
      },
      "severity": {
        "type": "string",
        "enum": ["info", "minor", "major", "critical"],
        "description": "Relative importance or impact of the feedback."
      },
      "timestamp": {
        "type": "string",
        "format": "date-time",
        "description": "When the feedback was created."
      },
      "resolution": {
        "type": "string",
        "enum": ["open", "addressed", "dismissed"],
        "description": "Current resolution state."
      }
    },
    "additionalProperties": false
  },
  "examples": [
    [
      {
        "author": "Director",
        "facet": "post_copy",
        "path": "/headline",
        "message": "Tone is too self-promotional; make it more grateful.",
        "severity": "major",
        "timestamp": "2025-10-28T09:15:00Z",
        "resolution": "open"
      },
      {
        "author": "Copywriter",
        "facet": "post_copy",
        "message": "Tone feedback addressed.",
        "note": "Softened headline and CTA phrasing.",
        "timestamp": "2025-10-28T10:02:00Z",
        "resolution": "addressed"
      }
    ]
  ]
}
```

**semantics**

* facet binds feedback to a well-known contract element.

* The planner uses these references to identify affected graph nodes automatically (no embedded logic or directives).

* path narrows scope for fine-grained feedback targeting.

* Agents addressing items append their own entry with a note and updated resolution.

* Serves both as conversational context and as a change log for future learning loops.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]

Understood — keeping post\_copy as a single, minimal text field makes it clean and consistent with how you simplified strategic\_rationale.

Here’s the revised definition.

---

## Facet post\_copy

**name**: post\_copy

**title**: Post Copy

**description**

The written text of a social post. This is the composed copy.

**schema** (JSON Schema fragment)

```
{
  "type": "string",
  "description": "Full text of the social post",
  "examples": [
    "Efficiency by Choice. /n /n We’re grateful to Acme Corp for sharing how they achieved 32% higher efficiency using our platform. Real results, real partnership. /n #partnership #acme"
  ]
}
```

**semantics**

* Overwrites previous versions rather than appending.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet post\_visual

**name**: post\_visual

**title**: Post Visual

**description**

References to one or more visual assets associated with a social post.

Produced by the Designer agent and consumed by reviewers and publishers.

**schema** (JSON Schema fragment)

```
{
  "type": "array",
  "description": "List of R2 asset URLs representing the visuals for the post.",
  "items": {
    "type": "string",
    "format": "uri",
    "description": "Direct URL to a visual asset (e.g., image, PDF, or short video)."
  },
  "examples": [
    [
      "https://r2.companyx.com/social/acme_case_banner_final.jpg",
      "https://r2.companyx.com/social/acme_chart.pdf"
    ]
  ]
}
```

**semantics**

* Produced by designer.VisualDesign; reviewed by director.SocialPostingReview.

* Contains publication-ready asset references (stored in R2).

* The first URL is treated as the primary visual when needed by downstream systems.

* Each execution replaces the array with an updated list of current visual assets (so no versioning)

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet post

**name**: post

**title**: Social Post

**description**

The complete, ready-to-publish social post content, combining approved text and associated visuals.

Represents the final creative deliverable produced by the review stage.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["copy", "visuals"],
  "properties": {
    "copy": {
      "type": "string",
      "description": "Final text of the social post."
    },
    "visuals": {
      "type": "array",
      "description": "R2 asset URLs for the final visuals associated with this post.",
      "items": { "type": "string", "format": "uri" }
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "copy": "We’re grateful to Acme Corp for sharing how they achieved 32% higher efficiency using our platform. Real results, real partnership.",
      "visuals": ["https://r2.companyx.com/social/acme_case_banner_final.jpg"]
    }
  ]
}
```

**semantics**

* Produced by director.SocialPostingReview.

* Consumed by publishing or external distribution systems.

* Represents the canonical output of the creative process — content-only, free of workflow or approval metadata.

* Downstream systems attach runtime policy data (approval state, versioning, audit trail) separately within the task envelope.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet positioning\_context

**name**: positioning\_context

**title**: Positioning Context

**description**

Structured input describing a company’s market, audience, and competitive environment.

Provides the grounding context for agents evaluating or refining company positioning.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["company_name", "company_url"],
  "properties": {
    "company_name": {
      "type": "string",
      "description": "Official name of the company being positioned."
    },
    "company_url": {
      "type": "string",
      "format": "uri",
      "description": "Primary website or landing page for the company."
    },
    "sector": {
      "type": "string",
      "description": "Industry or market sector (e.g., 'Industrial IoT', 'B2B SaaS')."
    },
    "target_audience": {
      "type": "string",
      "description": "Primary audience or buyer persona the positioning should address."
    },
    "target_geography": {
      "type": "string",
      "description": "Geographic focus or markets where the company operates (e.g., 'Europe', 'North America', 'Global')."
    },
    "competing_factors": {
      "type": "array",
      "description": "Key factors buyers use to evaluate companies in this space (e.g., price, innovation, reliability).",
      "items": { "type": "string" }
    },
    "competitors": {
      "type": "array",
      "description": "List of competitor URLs or profiles for benchmarking.",
      "items": { "type": "string", "format": "uri" }
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "company_name": "Acme Analytics",
      "company_url": "https://acmeanalytics.io",
      "sector": "Industrial IoT",
      "target_audience": "Operations and plant managers in mid-sized manufacturing firms",
      "target_geography": "Europe",
      "competing_factors": ["Data reliability", "Ease of integration", "Support responsiveness"],
      "competitors": [
        "https://contosoindustrial.com",
        "https://factoryinsights.ai"
      ]
    }
  ]
}
```

**semantics**

* Used primarily by strategist.Positioning and copywriter.Messaging.

* Captures external context: audience, geography, and the competitive landscape.

* competing\_factors describe buyer evaluation dimensions, enabling comparison across competitors.

* competitors provides reference entities for market analysis; data retrieval or scoring is handled dynamically from public information.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet positioning\_recommendation

**name**: positioning\_recommendation

**title**: Positioning Recommendation

**description**

Represents the recommended company positioning expressed as a set of **competing factors** with target scores.

Each factor reflects how strongly the company should aim to perform relative to competitors.

Includes accompanying rationale that explains why this configuration is optimal based on analytical and language-model reasoning.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["factors", "rationale"],
  "properties": {
    "factors": {
      "type": "array",
      "description": "List of competing factors with target positioning scores (0–10).",
      "items": {
        "type": "object",
        "required": ["name", "target_score"],
        "properties": {
          "name": {
            "type": "string",
            "description": "Name of the competing factor (e.g., 'ease of integration', 'local consulting partners')."
          },
          "target_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Target positioning score for this factor."
          },
          "current_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Optional current observed score, used to measure positioning distance."
          },
          "trend_alignment": {
            "type": "string",
            "enum": ["positive", "neutral", "negative"],
            "description": "Alignment of this factor with current market trends."
          },
          "comment": {
            "type": "string",
            "description": "Short reasoning comment for this factor (e.g., 'Integration is a differentiator for industrial clients')."
          }
        },
        "additionalProperties": false
      }
    },
    "fit_analysis": {
      "type": "string",
      "description": "Short summary evaluating whether this positioning fits the company’s current capabilities and brand trajectory."
    },
    "rationale": {
      "type": "string",
      "description": "Free-text explanation of why this positioning configuration is recommended."
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "factors": [
        {
          "name": "ease of integration",
          "target_score": 8.5,
          "current_score": 7,
          "trend_alignment": "positive",
          "comment": "Integration remains a strong buying driver in B2B analytics."
        },
        {
          "name": "local consulting partners",
          "target_score": 8,
          "current_score": 6.5,
          "trend_alignment": "neutral",
          "comment": "Expanding partnerships will increase accessibility and trust in regional markets."
        },
        {
          "name": "AI-driven insights",
          "target_score": 7.5,
          "current_score": 8,
          "trend_alignment": "positive",
          "comment": "Already strong, should maintain but not overspend relative to competitors."
        }
      ],
      "fit_analysis": "Recommended configuration aligns with Acme’s operational strengths and market direction, with manageable distance from current positioning.",
      "rationale": "Based on statistical benchmarking of 12 competitors and qualitative LLM reasoning, this balance improves differentiation and trend alignment while maintaining authenticity."
    }
  ]
}
```

**semantics**

* Produced by strategist.Positioning.

* Consumed by copywriter.Messaging and director.PositioningReview.

* factors\[\] quantify desired positioning targets; numeric values allow comparison, tracking, and visual mapping.

* fit\_analysis describes feasibility relative to the company’s current state.

* rationale captures overall justification and ties the quantitative and qualitative reasoning together.

* Enables data-driven positioning recommendations while preserving interpretability for human review.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]

## Facet messaging\_stack

**name**: messaging\_stack

**title**: Messaging Stack

**description**

Translates the company’s positioning into a structured hierarchy of key messages.

Each entry defines one message pillar, an associated proof point, and the suggested phrasing used to express it publicly.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["core_message", "messages"],
  "properties": {
    "core_message": {
      "type": "string",
      "description": "The high-level value proposition that summarizes the company's market position."
    },
    "message_pillars": {
      "type": "array",
      "description": "Message pillars derived from the positioning recommendation.",
      "items": {
        "type": "object",
        "required": ["pillar", "proof_point", "message"],
        "properties": {
          "pillar": {
            "type": "string",
            "description": "Name or short summary of the message pillar."
          },
          "proof_point": {
            "type": "string",
            "description": "Short fact, data point, or example supporting this pillar."
          },
          "message": {
            "type": "string",
            "description": "20–30 word phrasing showing how this message should be expressed in copy."
          }
        },
        "additionalProperties": false
      }
    },
    "tone": {
      "type": "string",
      "description": "Recommended tone or voice for communicating the overall message stack (e.g., 'authoritative', 'confident', 'pragmatic')."
    },
    "alignment_summary": {
      "type": "string",
      "description": "Short explanation linking each message to the underlying positioning factors."
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "core_message": "The trusted partner helping manufacturers turn industrial data into operational excellence.",
      "message_pillars": [
        {
          "pillar": "Seamless integration",
          "proof_point": "Connects with all major MES and SCADA systems.",
          "message": "We make factory data flow effortlessly, so insights reach the people who can act on them fastest."
        },
        {
          "pillar": "Local expertise",
          "proof_point": "Partner network in 12 European markets.",
          "message": "Our local partners combine global tech with regional know-how to deliver impact that fits each plant."
        },
        {
          "pillar": "Reliable results",
          "proof_point": "Average 30% efficiency gains across deployments.",
          "message": "Every engagement is measured by one thing: consistent, proven results on the factory floor."
        }
      ]
    }
  ]
}
```

**semantics**

* Produced by copywriter.Messaging; consumed by director.PositioningReview.

* core\_message expresses the overarching proposition.

* Each item in message\_pillars\[\] forms a coherent unit: pillar → proof → phrasing.

* Encourages clear alignment between strategic factors and creative execution.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet: positioning

**name**: positioning

**title**: Final Positioning

**description**

Represents the company’s approved market positioning after review.

It consolidates the quantitative factor-based recommendation and the qualitative messaging into a single, publishable strategic artifact.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["positioning_summary", "factors", "messaging_stack"],
  "properties": {
    "positioning_summary": {
      "type": "string",
      "description": "A concise paragraph summarizing the company’s agreed market position and differentiation focus."
    },
    "factors": {
      "type": "array",
      "description": "Set of competing factors and their final target scores after review.",
      "items": {
        "type": "object",
        "required": ["name", "target_score"],
        "properties": {
          "name": {
            "type": "string",
            "description": "Competing factor name (e.g., 'ease of integration', 'local expertise')."
          },
          "target_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Final agreed positioning score for this factor."
          },
          "trend_alignment": {
            "type": "string",
            "enum": ["positive", "neutral", "negative"],
            "description": "Alignment of the factor with market trends."
          }
        },
        "additionalProperties": false
      }
    },
    "messaging_stack": {
      "type": "object",
      "description": "The approved messaging structure derived from this positioning.",
      "properties": {
        "core_message": { "type": "string" },
        "message_pillars": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["pillar", "proof_point", "message"],
            "properties": {
              "pillar": { "type": "string" },
              "proof_point": { "type": "string" },
              "message": { "type": "string" }
            },
            "additionalProperties": false
          }
        }
      },
      "required": ["core_message", "message_pillars"],
      "additionalProperties": false
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "positioning_summary": "Acme Analytics is Europe’s most reliable industrial data partner, helping manufacturers achieve measurable efficiency through seamless integration and local expertise.",
      "factors": [
        {
          "name": "ease of integration",
          "target_score": 8.5,
          "trend_alignment": "positive"
        },
        {
          "name": "local consulting partners",
          "target_score": 8.0,
          "trend_alignment": "neutral"
        },
        {
          "name": "reliability",
          "target_score": 9.0,
          "trend_alignment": "positive"
        }
      ],
      "messaging_stack": {
        "core_message": "The trusted partner helping manufacturers turn industrial data into operational excellence.",
        "message_pillars": [
          {
            "pillar": "Seamless integration",
            "proof_point": "Connects with all major MES and SCADA systems.",
            "message": "We make factory data flow effortlessly, so insights reach the people who can act on them fastest."
          },
          {
            "pillar": "Local expertise",
            "proof_point": "Partner network in 12 European markets.",
            "message": "Our local partners combine global tech with regional know-how to deliver impact that fits each plant."
          }
        ]
      }
    }
  ]
}
```

**semantics**

* Produced by director.PositioningReview after approval.

* Combines the quantitative factor model from positioning\_recommendation and the narrative framework from messaging\_stack.

* Serves as the single source of truth for future brand, marketing, and product communication decisions.

* Downstream systems or agents (e.g., campaign planners, content generators) can consume this facet to ensure consistency.

**metadata**
* version: 1.0.0 
* direction: output
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]

## Facet value\_canvas

**name**: value\_canvas

**title**: Value Canvas

**description**

A comparative dataset showing competing factor scores across the focal company and its competitors.

Used to analyze relative strengths, weaknesses, and opportunities in the market.

Serves as the analytical input for the strategist when generating the positioning recommendation.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["companies", "factors", "scores"],
  "properties": {
    "companies": {
      "type": "array",
      "description": "List of companies included in the comparison (including the focal company).",
      "items": { "type": "string" }
    },
    "factors": {
      "type": "array",
      "description": "List of competing factors being evaluated.",
      "items": { "type": "string" }
    },
    "scores": {
      "type": "array",
      "description": "Matrix of scores for each company and competing factor.",
      "items": {
        "type": "object",
        "required": ["company", "factor", "score"],
        "properties": {
          "company": {
            "type": "string",
            "description": "Company name corresponding to the entry in `companies`."
          },
          "factor": {
            "type": "string",
            "description": "Name of the competing factor being scored."
          },
          "score": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Normalized score for this company on this factor (0–10 scale)."
          },
          "trend_alignment": {
            "type": "string",
            "enum": ["positive", "neutral", "negative"],
            "description": "Optional indicator of how the factor aligns with current market trends for this company."
          }
        },
        "additionalProperties": false
      }
    },
    "source": {
      "type": "string",
      "description": "Brief description or URL of the data source or benchmark used to derive scores (e.g., public data, analyst report)."
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "companies": [
        "Acme Analytics",
        "Contoso Industrial",
        "FactoryInsights"
      ],
      "factors": [
        "ease of integration",
        "local consulting partners",
        "reliability",
        "AI-driven insights"
      ],
      "scores": [
        { "company": "Acme Analytics", "factor": "ease of integration", "score": 8.2 },
        { "company": "Acme Analytics", "factor": "local consulting partners", "score": 6.5 },
        { "company": "Acme Analytics", "factor": "reliability", "score": 9.0 },
        { "company": "Acme Analytics", "factor": "AI-driven insights", "score": 7.8 },
        { "company": "Contoso Industrial", "factor": "ease of integration", "score": 7.0 },
        { "company": "Contoso Industrial", "factor": "local consulting partners", "score": 8.0 },
        { "company": "FactoryInsights", "factor": "reliability", "score": 7.5 },
        { "company": "FactoryInsights", "factor": "AI-driven insights", "score": 8.4 }
      ],
      "source": "Derived from public product data and analyst reports."
    }
  ]
}
```

**semantics**

* Produced by strategist.Positioning or an analytical sub-agent.

* Consumed by the same agent (for iterative reasoning) and by director.PositioningReview for transparency.

* Provides a structured **competitive benchmark** that feeds directly into the positioning\_recommendation.

* Each (company, factor) pair represents one datapoint; together, the facet forms a normalized scoring matrix.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]


## Facet positioning\_opportunities

**name**: positioning\_opportunities

**title**: Positioning Opportunities

**description**

Represents potential opportunity areas derived from the **value\_canvas** analysis.

Each opportunity highlights an under-served or emerging factor where the focal company can credibly differentiate, improve, or reposition.

It’s a structured map of *where to move next* based on current performance, competitor gaps, and market trends.

**schema** (JSON Schema fragment)

```
{
  "type": "object",
  "required": ["opportunities"],
  "properties": {
    "opportunities": {
      "type": "array",
      "description": "List of identified positioning opportunities.",
      "items": {
        "type": "object",
        "required": ["factor", "opportunity_type", "description"],
        "properties": {
          "factor": {
            "type": "string",
            "description": "The competing factor this opportunity relates to (e.g., 'local consulting partners')."
          },
          "opportunity_type": {
            "type": "string",
            "enum": ["improve_own_score", "fill_market_gap", "exploit_trend", "defend_position"],
            "description": "Type of opportunity detected."
          },
          "description": {
            "type": "string",
            "description": "Free-text description explaining the nature of the opportunity."
          },
          "current_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Current company score for this factor from the value_canvas."
          },
          "average_competitor_score": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Average competitor score for the same factor."
          },
          "trend_alignment": {
            "type": "string",
            "enum": ["positive", "neutral", "negative"],
            "description": "How this factor aligns with market trends."
          },
          "potential_gain": {
            "type": "number",
            "minimum": 0,
            "maximum": 10,
            "description": "Estimated potential improvement if the company addresses this opportunity (0–10 scale)."
          },
          "confidence": {
            "type": "number",
            "minimum": 0,
            "maximum": 1,
            "description": "Relative confidence score for this opportunity assessment (0–1)."
          }
        },
        "additionalProperties": false
      }
    },
    "summary": {
      "type": "string",
      "description": "Narrative summary describing overall opportunity landscape and key recommended focus areas."
    }
  },
  "additionalProperties": false,
  "examples": [
    {
      "opportunities": [
        {
          "factor": "local consulting partners",
          "opportunity_type": "improve_own_score",
          "description": "Acme’s partner network lags behind competitors; expanding coverage can strengthen trust and customer proximity.",
          "current_score": 6.5,
          "average_competitor_score": 8.0,
          "trend_alignment": "neutral",
          "potential_gain": 2.0,
          "confidence": 0.85
        },
        {
          "factor": "AI-driven insights",
          "opportunity_type": "exploit_trend",
          "description": "High market momentum for explainable AI in industrial data — potential to emphasize transparency and control.",
          "current_score": 8.0,
          "average_competitor_score": 7.4,
          "trend_alignment": "positive",
          "potential_gain": 1.0,
          "confidence": 0.9
        }
      ],
      "summary": "Acme has clear differentiation potential in AI transparency and local expertise expansion. Focus investment on partnership ecosystem and narrative consistency."
    }
  ]
}
```

**semantics**

* Produced by strategist.Positioning; consumed by director.PositioningReview.

* Derived from value\_canvas using a mix of statistical comparison and LLM reasoning.

* Each opportunity quantifies a potential move — improving weak factors, defending strong ones, or exploiting trend shifts.

* The summary gives a human-readable synthesis for presentation or rationale generation.

* Feeds directly into positioning\_recommendation creation as the strategic input.

**metadata**
* version: 1.0.0 
* direction: bidirectional
* requiredByDefault: true
* catalogTags: ["marketing-agency", "sandbox"]
