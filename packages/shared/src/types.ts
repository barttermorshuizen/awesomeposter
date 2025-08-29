// Asset Types for Digital Marketeer and Copywriter
export type FormatType = "text" | "single_image" | "multi_image" | "document_pdf" | "video";

export type AssetType = 'image' | 'document' | 'video' | 'audio' | 'other';

export type Asset = {
  id: string;
  filename: string;
  originalName?: string;
  url: string;
  type: AssetType;
  mimeType?: string;
  fileSize?: number;
  metaJson?: Record<string, unknown>;
};

export type AssetAnalysis = {
  availableAssets: Asset[];
  achievableFormats: FormatType[];
  recommendedFormat: FormatType;
  assetQuality: {
    images: { count: number; quality: 'high' | 'medium' | 'low' };
    documents: { count: number; hasSlides: boolean };
    videos: { count: number; duration?: number };
  };
  formatFeasibility: Record<FormatType, {
    feasible: boolean;
    reason: string;
    assetRequirements: string[];
  }>;
  recommendations: string[];
};

export type PrimaryCommunicationLanguage = 'Nederlands' | 'UK English' | 'US English' | 'Francais';

export type StructureKnobs = {
  lengthLevel: number;    // 0.0-1.0: target character budget (300-2400 chars)
  scanDensity: number;    // 0.0-1.0: how skimmable (paragraphs vs bullets)
};

export type Knobs = {
  formatType: FormatType;           // Primary creative container
  hookIntensity: number;            // 0.0-1.0: strength of opening line
  expertiseDepth: number;           // 0.0-1.0: practitioner-level specificity
  structure: StructureKnobs;        // Length and scannability controls
};

export type Assets = {
  images?: Asset[];                // Image assets
  documents?: Asset[];             // Document assets (PDFs, etc.)
  videos?: Asset[];                // Video assets
  audio?: Asset[];                 // Audio assets
  other?: Asset[];                 // Other asset types
};

export type ClientPolicy = {
  voice: "formal" | "balanced" | "edgy";
  emojiAllowed: boolean;
  maxHookIntensity: number;         // Cap for hook intensity
  bannedClaims: string[];           // Banned phrases/claims
};

export type KnobPayload = {
  formatType: FormatType;
  hookIntensity: number;
  expertiseDepth: number;
  structure: StructureKnobs;
  assets: Assets;
  clientPolicy: ClientPolicy;
};

export type Strategy = {
  platforms: ("linkedin" | "x")[];
  structure: string;                // e.g., "hook → insight → CTA"
  themes: string[];                 // content themes and angles
  hashtags: string[];               // suggested hashtags
  timing?: string[];                // suggested publishing windows
  objective: string;                // One-sentence strategy objective
};

export type Draft = {
  platform: "linkedin" | "x";
  post: string;
  headlineOptions?: string[];
  altText?: string;
  charCount?: number;
  variantId?: string;
  usedAssets?: string[];            // Assets actually used in this draft
  sectionsCount?: number;           // Number of content sections
  hookLine?: string;                // The actual hook line used
};

export type Scores = {
  readability: number;              // 0-1: how easy to read
  clarity: number;                  // 0-1: how clear the message is
  objectiveFit: number;             // 0-1: how well it meets the objective
  brandRisk: number;                // 0-1: brand safety score
  compliance: boolean;              // meets platform and legal requirements
  composite?: number;               // weighted overall score
};

export type Telemetry = {
  knobs: KnobPayload;
  observables: {
    impressions?: number;
    seeMoreExpands?: number;
    reactions?: number;
    comments?: number;
    shares?: number;
    linkClicks?: number;
    videoViews?: number;
    dwellSecondsEst?: number;
  };
  derivedMetrics: {
    engagementRate?: number;
    commentDepth?: number;
    scrollStopRate?: number;
    readToLikeRatio?: number;
  };
  renderMetrics: {
    linesCount?: number;
    avgLineChars?: number;
    totalChars: number;
    frameworkIncluded?: boolean;
    metricCount?: number;
  };
};

export type AgentState = {
  objective: string;
  inputs: { 
    brief: { 
      id?: string;              // Brief ID for fetching assets
      title: string; 
      description?: string;
      objective?: string;
      audienceId?: string;
    };
    clientProfile?: {
      primaryCommunicationLanguage?: PrimaryCommunicationLanguage;
      objectivesJson: Record<string, unknown>;
      audiencesJson: Record<string, unknown>;
      toneJson: Record<string, unknown>;
      specialInstructionsJson: Record<string, unknown>;
      guardrailsJson: Record<string, unknown>;
      platformPrefsJson: Record<string, unknown>;
    };
    assets?: Asset[];              // Available assets for the brief
    analytics?: {
      topPosts: Array<{
        content: string;
        performance: Record<string, unknown>;
        platform: string;
      }>;
    };
  };
  knobs?: Knobs;
  knobPayload?: KnobPayload;
  strategy?: Strategy;
  drafts?: Draft[];
  scores?: Record<string, Scores>;
  schedule?: { windows: Record<string, string> };
  deliverables?: { 
    utm: string; 
    finalPosts: Draft[];
    rationale: string;
  };
  rationale?: string;
  telemetry?: Telemetry;
  assetAnalysis?: AssetAnalysis;   // Asset analysis and format feasibility
};

export type RevisionInstruction = {
  variantId: string;
  feedback: string;
  suggestedChanges: string[];
  priority: "high" | "medium" | "low";
};

export type AgentResponse = {
  success: boolean;
  state: Partial<AgentState>;
  instructions?: RevisionInstruction[];
  error?: string;
};

// Platform-specific rules and constraints
export const platformRules = {
  linkedin: { 
    maxChars: 3000, 
    maxHashtags: 5,
    recommendedLength: 1300,
    hashtagPlacement: "end"
  },
  x: { 
    maxChars: 280, 
    maxHashtags: 3,
    recommendedLength: 200,
    hashtagPlacement: "inline"
  }
} as const;

// Scoring weights for composite score calculation
export const scoringWeights = {
  readability: 0.35,
  objectiveFit: 0.35,
  clarity: 0.20,
  brandRisk: -0.20  // negative weight - higher risk = lower score
} as const;

// Thresholds for agent decisions
export const agentThresholds = {
  minCompositeScore: 0.78,
  maxBrandRisk: 0.2,
  maxRevisionCycles: 2,
  minVariantsToGenerate: 3,
  maxVariantsToGenerate: 5
} as const;

// Default knob values (safe, proven baselines)
export const defaultKnobs: KnobPayload = {
  formatType: "text",
  hookIntensity: 0.65,
  expertiseDepth: 0.7,
  structure: {
    lengthLevel: 0.6,
    scanDensity: 0.85
  },
  assets: {
    images: [],
    documents: [],
    videos: [],
    audio: [],
    other: []
  },
  clientPolicy: {
    voice: "balanced",
    emojiAllowed: true,
    maxHookIntensity: 0.85,
    bannedClaims: []
  }
};

// Validation constraints for knobs
export const knobConstraints = {
  maxTotalChars: 2900,              // Leave room for hashtags/mentions
  maxHookIntensity: {
    formal: 0.8,
    balanced: 1.0,
    edgy: 1.0
  },
  minImagesForMulti: 3,
  maxSlides: 8,
  maxHashtags: 5
} as const;


