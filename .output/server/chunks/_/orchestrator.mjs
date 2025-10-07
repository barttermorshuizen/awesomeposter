import OpenAI from 'openai';
import { g as getEnv } from './env.mjs';

let client = null;
function getOpenAI() {
  if (client) return client;
  const env = getEnv();
  client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  return client;
}
function getDefaultChatModelName() {
  const m = process.env.OPENAI_DEFAULT_MODEL || process.env.OPENAI_MODEL || "gpt-4o";
  return (m).toString().trim();
}

const platformRules = {
  linkedin: {
    maxChars: 3e3,
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
};
const scoringWeights = {
  readability: 0.35,
  objectiveFit: 0.35,
  clarity: 0.2,
  brandRisk: -0.2
  // magnitude used in composite; brand risk is applied inversely (brandSafety = 1 - brandRisk) with an offset to preserve scale
};
const agentThresholds = {
  minCompositeScore: 0.78,
  maxBrandRisk: 0.2,
  maxRevisionCycles: 2,
  minVariantsToGenerate: 3,
  maxVariantsToGenerate: 5
};

const clamp01 = (n) => Math.max(0, Math.min(1, n));
function computeCompositeScore({ readability, clarity, objectiveFit, brandRisk }, opts) {
  const r = clamp01(Number(readability != null ? readability : 0));
  const c = clamp01(Number(clarity != null ? clarity : 0));
  const o = clamp01(Number(objectiveFit != null ? objectiveFit : 0));
  const br = clamp01(Number(brandRisk != null ? brandRisk : 0));
  const base = scoringWeights;
  let w = base;
  const brW = Math.abs(w.brandRisk);
  const score = r * w.readability + o * w.objectiveFit + c * w.clarity + brW * (1 - br) - brW;
  return clamp01(score);
}

var __defProp$2 = Object.defineProperty;
var __defNormalProp$2 = (obj, key, value) => key in obj ? __defProp$2(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$2 = (obj, key, value) => __defNormalProp$2(obj, typeof key !== "symbol" ? key + "" : key, value);
class DigitalMarketeerAgent {
  constructor() {
    __publicField$2(this, "openai", getOpenAI());
    __publicField$2(this, "model", getDefaultChatModelName());
  }
  /**
   * Analyze available assets and determine achievable formats
   */
  async analyzeAssets(assets) {
    try {
      const images = assets.filter((a) => a.type === "image");
      const documents = assets.filter((a) => a.type === "document");
      const videos = assets.filter((a) => a.type === "video");
      const assetQuality = {
        images: {
          count: images.length,
          quality: this.assessImageQuality(images)
        },
        documents: {
          count: documents.length,
          hasSlides: documents.some((d) => {
            var _a, _b;
            return ((_a = d.mimeType) == null ? void 0 : _a.includes("pdf")) || ((_b = d.mimeType) == null ? void 0 : _b.includes("presentation"));
          })
        },
        videos: {
          count: videos.length,
          duration: void 0
          // Could be extracted from video metadata in future
        }
      };
      const formatFeasibility = this.assessFormatFeasibility(assetQuality);
      const achievableFormats = Object.entries(formatFeasibility).filter(([, assessment]) => assessment.feasible).map(([format]) => format);
      const recommendedFormat = this.recommendBestFormat(assetQuality, achievableFormats);
      const recommendations = this.generateAssetRecommendations(assetQuality);
      return {
        availableAssets: assets,
        achievableFormats,
        recommendedFormat,
        assetQuality,
        formatFeasibility,
        recommendations
      };
    } catch (error) {
      console.error("Error in asset analysis:", error);
      return {
        availableAssets: assets,
        achievableFormats: ["text"],
        recommendedFormat: "text",
        assetQuality: {
          images: { count: 0, quality: "low" },
          documents: { count: 0, hasSlides: false },
          videos: { count: 0, duration: void 0 }
        },
        formatFeasibility: {
          text: { feasible: true, reason: "Always available", assetRequirements: [] },
          single_image: { feasible: false, reason: "No images available", assetRequirements: ["At least 1 image"] },
          multi_image: { feasible: false, reason: "Insufficient images", assetRequirements: ["At least 3 images"] },
          document_pdf: { feasible: false, reason: "No documents available", assetRequirements: ["PDF or presentation document"] },
          video: { feasible: false, reason: "No video available", assetRequirements: ["Video file"] }
        },
        recommendations: ["Consider adding visual assets to enhance engagement"]
      };
    }
  }
  /**
   * Assess image quality based on count and metadata
   */
  assessImageQuality(images) {
    if (images.length === 0) return "low";
    if (images.length >= 3) return "high";
    if (images.length >= 1) return "medium";
    return "low";
  }
  /**
   * Assess format feasibility based on available assets
   */
  assessFormatFeasibility(assetQuality) {
    return {
      text: {
        feasible: true,
        reason: "Text format always available",
        assetRequirements: []
      },
      single_image: {
        feasible: assetQuality.images.count >= 1,
        reason: assetQuality.images.count >= 1 ? "Sufficient images available" : "At least 1 image required",
        assetRequirements: assetQuality.images.count >= 1 ? [] : ["At least 1 image"]
      },
      multi_image: {
        feasible: assetQuality.images.count >= 3,
        reason: assetQuality.images.count >= 3 ? "Sufficient images for multi-image format" : "At least 3 images required",
        assetRequirements: assetQuality.images.count >= 3 ? [] : ["At least 3 images"]
      },
      document_pdf: {
        feasible: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides,
        reason: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides ? "Document with slides available" : "PDF or presentation document required",
        assetRequirements: assetQuality.documents.count >= 1 && assetQuality.documents.hasSlides ? [] : ["PDF or presentation document"]
      },
      video: {
        feasible: assetQuality.videos.count >= 1,
        reason: assetQuality.videos.count >= 1 ? "Video available" : "Video file required",
        assetRequirements: assetQuality.videos.count >= 1 ? [] : ["Video file"]
      }
    };
  }
  /**
   * Recommend best format based on assets and objectives
   */
  recommendBestFormat(assetQuality, achievableFormats) {
    const formatPriority = ["document_pdf", "multi_image", "single_image", "video", "text"];
    for (const format of formatPriority) {
      if (achievableFormats.includes(format)) {
        return format;
      }
    }
    return "text";
  }
  /**
   * Generate asset recommendations for improvement
   */
  generateAssetRecommendations(assetQuality) {
    const recommendations = [];
    if (assetQuality.images.count === 0) {
      recommendations.push("Add at least 1-2 high-quality images to enable visual content formats");
    } else if (assetQuality.images.count < 3) {
      recommendations.push("Add more images (3+) to enable multi-image carousel formats");
    }
    if (assetQuality.documents.count === 0) {
      recommendations.push("Consider adding a PDF or presentation document for deep content formats");
    }
    if (assetQuality.videos.count === 0) {
      recommendations.push("Video content can significantly increase engagement - consider adding video assets");
    }
    if (recommendations.length === 0) {
      recommendations.push("Excellent asset variety - you can create any content format");
    }
    return recommendations;
  }
  /**
   * Plan strategy and set 4-knob values based on brief and client profile
   */
  async planStrategy(state) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o;
    try {
      console.log("\u{1F9E9} planStrategy received assets:", {
        hasAssetsArray: !!((_a = state.inputs) == null ? void 0 : _a.assets),
        assetsCount: ((_c = (_b = state.inputs) == null ? void 0 : _b.assets) == null ? void 0 : _c.length) || 0,
        sample: (((_d = state.inputs) == null ? void 0 : _d.assets) || []).slice(0, 2).map((a) => ({
          id: a.id,
          filename: a.filename,
          type: a.type,
          mimeType: a.mimeType
        }))
      });
      let assetAnalysis;
      if (state.inputs.assets && state.inputs.assets.length > 0) {
        console.log("\u{1F50D} Analyzing available assets for format feasibility...");
        assetAnalysis = await this.analyzeAssets(state.inputs.assets);
        console.log("\u2705 Asset analysis completed:", {
          achievableFormats: assetAnalysis.achievableFormats,
          recommendedFormat: assetAnalysis.recommendedFormat,
          assetQuality: assetAnalysis.assetQuality
        });
      } else {
        console.log("\u26A0\uFE0F No assets available for analysis, using text format as fallback");
        assetAnalysis = {
          availableAssets: [],
          achievableFormats: ["text"],
          recommendedFormat: "text",
          assetQuality: {
            images: { count: 0, quality: "low" },
            documents: { count: 0, hasSlides: false },
            videos: { count: 0, duration: void 0 }
          },
          formatFeasibility: {
            text: { feasible: true, reason: "Always available", assetRequirements: [] },
            single_image: { feasible: false, reason: "No images available", assetRequirements: ["At least 1 image"] },
            multi_image: { feasible: false, reason: "Insufficient images", assetRequirements: ["At least 3 images"] },
            document_pdf: { feasible: false, reason: "No documents available", assetRequirements: ["PDF or presentation document"] },
            video: { feasible: false, reason: "No video available", assetRequirements: ["Video file"] }
          },
          recommendations: ["Consider adding visual assets to enhance engagement"]
        };
      }
      const prompt = this.buildStrategyPrompt(state, assetAnalysis);
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: `You are a Digital Marketeer agent specializing in social media strategy with 4-knob optimization. 
            Your role is to analyze briefs, client profiles, and available assets to create strategic content plans.
            Always respond with valid JSON that can be parsed directly.
            
            The 4-knob system consists of:
            1. formatType: Choose from 'text', 'single_image', 'multi_image', 'document_pdf', 'video' - MUST be achievable with available assets
            2. hookIntensity: 0.0-1.0 scale for opening line strength
            3. expertiseDepth: 0.0-1.0 scale for practitioner-level specificity
            4. structure: Object with lengthLevel (0.0-1.0) and scanDensity (0.0-1.0)
            
            CRITICAL CONSTRAINTS:
            - The formatType MUST be achievable with the available assets
            - NEVER choose a format that requires assets you don't have
            - If brief requests a format that's not achievable, choose the best achievable alternative
            - Consider client policy constraints and historical performance when setting knobs`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 500
      });
      console.log("\u{1F50D} OpenAI Response Object:", {
        hasChoices: !!response.choices,
        choicesLength: ((_e = response.choices) == null ? void 0 : _e.length) || 0,
        firstChoice: ((_f = response.choices) == null ? void 0 : _f[0]) ? {
          hasMessage: !!response.choices[0].message,
          messageRole: (_g = response.choices[0].message) == null ? void 0 : _g.role,
          hasContent: !!((_h = response.choices[0].message) == null ? void 0 : _h.content),
          contentLength: ((_j = (_i = response.choices[0].message) == null ? void 0 : _i.content) == null ? void 0 : _j.length) || 0
        } : "no first choice"
      });
      const content = (_l = (_k = response.choices[0]) == null ? void 0 : _k.message) == null ? void 0 : _l.content;
      if (!content) {
        console.error("\u274C Response structure issue:", {
          choices: response.choices,
          firstChoice: (_m = response.choices) == null ? void 0 : _m[0],
          message: (_o = (_n = response.choices) == null ? void 0 : _n[0]) == null ? void 0 : _o.message,
          responseKeys: Object.keys(response)
        });
        throw new Error("No response content from OpenAI");
      }
      const strategyData = JSON.parse(content);
      console.log("\u{1F50D} AI Response Structure:", {
        hasKnobs: !!strategyData.knobs,
        hasStrategy: !!strategyData.strategy,
        responseKeys: Object.keys(strategyData),
        knobsKeys: strategyData.knobs ? Object.keys(strategyData.knobs) : "none",
        strategyKeys: strategyData.strategy ? Object.keys(strategyData.strategy) : "none"
      });
      console.log("\u{1F50D} Raw AI Response:", JSON.stringify(strategyData, null, 2));
      if (!strategyData.knobs) {
        console.warn("\u26A0\uFE0F AI did not return knobs, creating default structure");
        strategyData.knobs = {
          formatType: (assetAnalysis == null ? void 0 : assetAnalysis.recommendedFormat) || "text",
          hookIntensity: 0.6,
          expertiseDepth: 0.7,
          structure: {
            lengthLevel: 0.6,
            scanDensity: 0.8
          }
        };
        console.log("\u2705 Created fallback knobs:", strategyData.knobs);
      } else {
        if (assetAnalysis && !assetAnalysis.achievableFormats.includes(strategyData.knobs.formatType)) {
          console.warn(`\u{1F6A8} AI chose format type '${strategyData.knobs.formatType}' but it's NOT achievable with available assets!`);
          console.log("\u{1F504} Available formats:", assetAnalysis.achievableFormats);
          console.log("\u{1F504} Forcing fallback to recommended format:", assetAnalysis.recommendedFormat);
          strategyData.knobs.formatType = assetAnalysis.recommendedFormat;
          if (strategyData.rationale) {
            strategyData.rationale += ` [NOTE: Format changed from '${strategyData.knobs.formatType}' to '${assetAnalysis.recommendedFormat}' due to insufficient assets]`;
          }
        }
      }
      if (!strategyData.strategy) {
        console.warn("\u26A0\uFE0F AI did not return strategy, creating from response data");
        strategyData.strategy = {
          platforms: strategyData.platforms || ["linkedin"],
          structure: strategyData.structure || "hook \u2192 insight \u2192 CTA",
          themes: strategyData.themes || ["professional"],
          hashtags: strategyData.hashtags || ["#business"],
          timing: strategyData.timing || "optimal business hours"
        };
        console.log("\u2705 Created fallback strategy:", strategyData.strategy);
      }
      if (state.inputs.clientProfile) {
        const validatedKnobs = this.validateKnobCompliance(strategyData.knobs, state.inputs.clientProfile);
        const assets = this.prepareAssetsForKnobPayload(state.inputs.assets || []);
        const response2 = {
          success: true,
          state: {
            knobs: validatedKnobs,
            strategy: strategyData.strategy,
            rationale: strategyData.rationale,
            assetAnalysis,
            knobPayload: {
              formatType: validatedKnobs.formatType,
              hookIntensity: validatedKnobs.hookIntensity,
              expertiseDepth: validatedKnobs.expertiseDepth,
              structure: validatedKnobs.structure,
              assets,
              clientPolicy: {
                voice: "balanced",
                emojiAllowed: true,
                maxHookIntensity: 0.85,
                bannedClaims: []
              }
            }
          }
        };
        console.log("\u{1F680} Returning to orchestrator:", {
          hasKnobs: !!response2.state.knobs,
          knobsKeys: response2.state.knobs ? Object.keys(response2.state.knobs) : "none",
          hasStrategy: !!response2.state.strategy,
          strategyKeys: response2.state.strategy ? Object.keys(response2.state.strategy) : "none",
          hasAssetAnalysis: !!response2.state.assetAnalysis
        });
        return response2;
      } else {
        const response2 = {
          success: true,
          state: {
            knobs: strategyData.knobs,
            strategy: strategyData.strategy,
            rationale: strategyData.rationale,
            assetAnalysis
          }
        };
        console.log("\u{1F680} Returning to orchestrator (no client profile):", {
          hasKnobs: !!response2.state.knobs,
          knobsKeys: response2.state.knobs ? Object.keys(response2.state.knobs) : "none",
          hasStrategy: !!response2.state.strategy,
          strategyKeys: response2.state.strategy ? Object.keys(response2.state.strategy) : "none",
          hasAssetAnalysis: !!response2.state.assetAnalysis
        });
        return response2;
      }
    } catch (error) {
      console.error("Error in planStrategy:", error);
      return {
        success: false,
        state: {},
        error: error instanceof Error ? error.message : "Unknown error in strategy planning"
      };
    }
  }
  /**
   * Evaluate and score draft variants with knob effectiveness consideration
   */
  async evaluateDrafts(state, drafts) {
    try {
      const scores = {};
      const instructions = [];
      for (const draft of drafts) {
        const score = await this.scoreDraft(state, draft);
        scores[draft.variantId || draft.platform] = score;
        if (score.composite && score.composite < agentThresholds.minCompositeScore) {
          instructions.push(this.generateRevisionInstruction(draft, score));
        }
      }
      return {
        success: true,
        state: { scores },
        instructions: instructions.length > 0 ? instructions : void 0
      };
    } catch (error) {
      console.error("Error in evaluateDrafts:", error);
      return {
        success: false,
        state: {},
        error: error instanceof Error ? error.message : "Unknown error in draft evaluation"
      };
    }
  }
  /**
   * Finalize strategy and prepare for publishing
   */
  async finalizeStrategy(state) {
    var _a, _b, _c, _d;
    try {
      const prompt = this.buildFinalizationPrompt(state);
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          {
            role: "system",
            content: `You are finalizing a social media strategy with 4-knob optimization. Provide publishing recommendations,
            UTM parameters, and a final rationale for the selected variants. Consider how the knob settings will impact performance.`
          },
          {
            role: "user",
            content: prompt
          }
        ],
        response_format: { type: "json_object" },
        max_tokens: 800
      });
      const content = (_b = (_a = response.choices[0]) == null ? void 0 : _a.message) == null ? void 0 : _b.content;
      if (!content) {
        throw new Error("No response content from OpenAI");
      }
      console.log("\u{1F50D} Raw AI response for finalization:", content);
      let finalizationData;
      try {
        finalizationData = JSON.parse(content);
      } catch (parseError) {
        console.error("\u274C Failed to parse AI response as JSON:", parseError);
        console.error("Raw content:", content);
        throw new Error("AI response is not valid JSON");
      }
      console.log("\u{1F4C5} Parsed finalization data:", {
        hasSchedule: !!finalizationData.schedule,
        scheduleKeys: finalizationData.schedule ? Object.keys(finalizationData.schedule) : "none",
        hasWindows: ((_c = finalizationData.schedule) == null ? void 0 : _c.windows) ? "yes" : "no",
        windowsKeys: ((_d = finalizationData.schedule) == null ? void 0 : _d.windows) ? Object.keys(finalizationData.schedule.windows) : "none"
      });
      let schedule = finalizationData.schedule;
      if (!schedule || !schedule.windows || Object.keys(schedule.windows).length === 0) {
        console.log("\u26A0\uFE0F AI did not provide proper schedule data, generating fallback...");
        schedule = this.generateFallbackSchedule(state);
      }
      return {
        success: true,
        state: {
          schedule,
          deliverables: finalizationData.deliverables
        }
      };
    } catch (error) {
      console.error("Error in finalizeStrategy:", error);
      return {
        success: false,
        state: {},
        error: error instanceof Error ? error.message : "Unknown error in strategy finalization"
      };
    }
  }
  /**
   * Score a single draft variant with knob effectiveness
   */
  async scoreDraft(state, draft) {
    var _a, _b;
    const prompt = this.buildScoringPrompt(state, draft);
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are evaluating social media content with 4-knob optimization. Score the given post on these dimensions
          and provide a score for each knob how well the content aligns with that knob setting.
          Always respond with valid JSON.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 500
    });
    const content = (_b = (_a = response.choices[0]) == null ? void 0 : _a.message) == null ? void 0 : _b.content;
    if (!content) {
      throw new Error("No scoring response from OpenAI");
    }
    const scores = JSON.parse(content);
    scores.composite = this.calculateCompositeScore(scores, state.knobs);
    return scores;
  }
  /**
   * Calculate composite score using weighted formula with knob effectiveness
   */
  calculateCompositeScore(scores, knobs) {
    let baseScore = computeCompositeScore(scores);
    if (knobs) {
      const knobAdjustment = this.calculateKnobAdjustment(scores, knobs);
      baseScore = Math.min(1, Math.max(0, baseScore + knobAdjustment));
    }
    return baseScore;
  }
  /**
   * Calculate knob effectiveness adjustment
   */
  calculateKnobAdjustment(scores, knobs) {
    let adjustment = 0;
    if (knobs.formatType === "document_pdf" && scores.objectiveFit > 0.8) {
      adjustment += 0.05;
    }
    if (knobs.hookIntensity > 0.7 && scores.readability > 0.8) {
      adjustment += 0.03;
    }
    if (knobs.expertiseDepth > 0.8 && scores.objectiveFit > 0.8) {
      adjustment += 0.03;
    }
    if (knobs.structure.scanDensity > 0.8 && scores.readability > 0.8) {
      adjustment += 0.02;
    }
    return adjustment;
  }
  /**
   * Validate knob compliance with client policy and constraints
   */
  validateKnobCompliance(knobs, clientProfile) {
    const clientPolicy = (clientProfile == null ? void 0 : clientProfile.clientPolicy) || {};
    const validatedKnobs = { ...knobs };
    if (clientPolicy.maxHookIntensity !== void 0) {
      validatedKnobs.hookIntensity = Math.min(knobs.hookIntensity, clientPolicy.maxHookIntensity);
    }
    if (clientPolicy.emojiAllowed === false) ;
    validatedKnobs.hookIntensity = Math.max(0, Math.min(1, validatedKnobs.hookIntensity));
    validatedKnobs.expertiseDepth = Math.max(0, Math.min(1, validatedKnobs.expertiseDepth));
    validatedKnobs.structure.lengthLevel = Math.max(0, Math.min(1, validatedKnobs.structure.lengthLevel));
    validatedKnobs.structure.scanDensity = Math.max(0, Math.min(1, validatedKnobs.structure.scanDensity));
    return validatedKnobs;
  }
  /**
   * Generate revision instructions for low-scoring variants
   */
  generateRevisionInstruction(draft, scores) {
    const feedback = this.generateFeedback(scores);
    const priority = scores.composite && scores.composite < 0.6 ? "high" : "medium";
    return {
      variantId: draft.variantId || draft.platform,
      feedback,
      suggestedChanges: this.suggestChanges(scores),
      priority
    };
  }
  /**
   * Generate feedback based on scores
   */
  generateFeedback(scores) {
    const feedbacks = [];
    if (scores.readability < 0.7) {
      feedbacks.push("Improve readability with shorter sentences and clearer language");
    }
    if (scores.clarity < 0.7) {
      feedbacks.push("Clarify the main message and reduce ambiguity");
    }
    if (scores.objectiveFit < 0.7) {
      feedbacks.push("Better align with the campaign objective");
    }
    if (scores.brandRisk > 0.3) {
      feedbacks.push("Address potential brand safety concerns");
    }
    return feedbacks.join(". ") || "Content meets quality standards";
  }
  /**
   * Suggest specific changes based on scores
   */
  suggestChanges(scores) {
    const suggestions = [];
    if (scores.readability < 0.7) {
      suggestions.push("Break long sentences into shorter ones");
      suggestions.push("Use simpler vocabulary");
    }
    if (scores.clarity < 0.7) {
      suggestions.push("Add a clear hook in the first line");
      suggestions.push("Simplify the call-to-action");
    }
    if (scores.objectiveFit < 0.7) {
      suggestions.push("Reference the campaign goal more explicitly");
      suggestions.push("Align tone with target audience");
    }
    return suggestions;
  }
  /**
   * Build prompt for 4-knob strategy planning
   */
  buildStrategyPrompt(state, assetAnalysis) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n;
    const { brief, clientProfile } = state.inputs;
    const languageContext = (clientProfile == null ? void 0 : clientProfile.primaryCommunicationLanguage) ? `

\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is ${clientProfile.primaryCommunicationLanguage}. ALL content must be optimized for this language and cultural context.` : "\n\n\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is not specified, defaulting to US English.";
    const assetContext = `

\u{1F4C1} ASSET ANALYSIS & FORMAT FEASIBILITY:
Available Assets: ${assetAnalysis.availableAssets.length} total
- Images: ${assetAnalysis.assetQuality.images.count} (${assetAnalysis.assetQuality.images.quality} quality)
- Documents: ${assetAnalysis.assetQuality.documents.count} (${assetAnalysis.assetQuality.documents.hasSlides ? "includes slides" : "no slides"})
- Videos: ${assetAnalysis.assetQuality.videos.count}

Achievable Formats: ${assetAnalysis.achievableFormats.join(", ")}
Recommended Format: ${assetAnalysis.recommendedFormat}

\u{1F6A8} CRITICAL FORMAT SELECTION RULES:
- You MUST ONLY choose from the achievable formats listed above
- NEVER choose a format that requires assets you don't have
- If the brief requests a format that's not achievable, choose the best achievable alternative
- The formatType field MUST be one of: ${assetAnalysis.achievableFormats.join(", ")}`;
    const clientProfileText = clientProfile ? `Client Profile:
- Primary Language: ${clientProfile.primaryCommunicationLanguage || "US English (default)"}
- Objectives: ${((_a = clientProfile.objectivesJson) == null ? void 0 : _a.primary) || "Increase brand awareness"}, ${((_b = clientProfile.objectivesJson) == null ? void 0 : _b.secondary) || "Drive engagement"}
- Target Audience: ${((_c = clientProfile.audiencesJson) == null ? void 0 : _c.target) || "General professional audience"}
- Demographics: ${((_d = clientProfile.audiencesJson) == null ? void 0 : _d.demographics) || "Professionals and decision makers"}
- Interests: ${Array.isArray((_e = clientProfile.audiencesJson) == null ? void 0 : _e.interests) && clientProfile.audiencesJson.interests.length > 0 ? clientProfile.audiencesJson.interests.join(", ") : "Professional development, industry trends"}
- Pain Points: ${Array.isArray((_f = clientProfile.audiencesJson) == null ? void 0 : _f.painPoints) && clientProfile.audiencesJson.painPoints.length > 0 ? clientProfile.audiencesJson.painPoints.join(", ") : "Information overload, time constraints"}
- Tone: ${((_g = clientProfile.toneJson) == null ? void 0 : _g.preset) || "Professional & Formal"}
- Voice: ${((_h = clientProfile.toneJson) == null ? void 0 : _h.voice) || "Balanced"}
${((_i = clientProfile.specialInstructionsJson) == null ? void 0 : _i.instructions) ? `- Special Instructions: ${clientProfile.specialInstructionsJson.instructions}` : ""}
${((_j = clientProfile.platformPrefsJson) == null ? void 0 : _j.primary) || ((_k = clientProfile.platformPrefsJson) == null ? void 0 : _k.secondary) ? `- Platform Preferences: ${[(_l = clientProfile.platformPrefsJson) == null ? void 0 : _l.primary, (_m = clientProfile.platformPrefsJson) == null ? void 0 : _m.secondary].filter(Boolean).join(", ")}` : ""}
${((_n = clientProfile.platformPrefsJson) == null ? void 0 : _n.focus) ? `- Focus: ${clientProfile.platformPrefsJson.focus}` : ""}
${(() => {
      var _a2, _b2, _c2;
      const banned = Array.isArray((_a2 = clientProfile.guardrailsJson) == null ? void 0 : _a2.banned) && clientProfile.guardrailsJson.banned.length > 0 ? `Banned topics (${clientProfile.guardrailsJson.banned.join(", ")})` : "";
      const sensitive = Array.isArray((_b2 = clientProfile.guardrailsJson) == null ? void 0 : _b2.sensitive) && clientProfile.guardrailsJson.sensitive.length > 0 ? `Sensitive topics (${clientProfile.guardrailsJson.sensitive.join(", ")})` : "";
      const required = Array.isArray((_c2 = clientProfile.guardrailsJson) == null ? void 0 : _c2.required) && clientProfile.guardrailsJson.required.length > 0 ? `Required elements (${clientProfile.guardrailsJson.required.join(", ")})` : "";
      const parts = [banned, sensitive, required].filter(Boolean);
      return parts.length ? `- Guardrails: ${parts.join(", ")}` : "";
    })()}` : "Client Profile: Not provided";
    return `You are a digital marketing strategist agent.  
Your task is to design a **tailored social media strategy** for the given client and brief.  
Do not copy the examples below; instead, generate new content that fits the context.${languageContext}${assetContext}

Brief: ${brief.title}  
Description: ${brief.description || "Not provided"}  
${clientProfileText}

Your output must be **valid JSON** in the following structure:

{
  "knobs": {
    "formatType": "<choose: text | single_image | multi_image | document_pdf | video>",
    "hookIntensity": "<float 0\u20131, how strong the attention-grabbing opening should be>",
    "expertiseDepth": "<float 0\u20131, how deep and authoritative the content should sound>",
    "structure": {
      "lengthLevel": "<float 0\u20131, length of post>",
      "scanDensity": "<float 0\u20131, how easy to scan with bullets/line breaks>"
    }
  },
  "strategy": {
    "platforms": ["<choose 1-2 platforms based on client profile and brief, e.g. linkedin>"],
    "structure": "<describe the post flow, e.g. 'hook \u2192 story \u2192 insight \u2192 CTA'>",
    "themes": ["<themes relevant to the brand/brief>"],
    "hashtags": ["<hashtags relevant to the themes/platform>"],
    "timing": "<best posting time for target audience>"
  },
  "rationale": "<explain why this strategy and knob settings make sense for this client and brief>"
}

CRITICAL REQUIREMENTS:
- Do not copy placeholders.  
- Every field must be context-specific and justified by the brief and client profile.  
- "rationale" must explain the reasoning behind platform choice, tone, knob settings, and timing.
- Consider the client's language preference when planning hashtags, themes, and cultural context.
- **\u{1F6A8} FORMAT SELECTION IS RESTRICTED: You MUST ONLY choose from the achievable formats: ${assetAnalysis.achievableFormats.join(", ")}**
- **\u{1F6A8} NEVER choose a format that requires assets you don't have**
- **\u{1F6A8} If the brief requests an unachievable format, choose the best achievable alternative and explain why in the rationale**`;
  }
  /**
   * Build prompt for draft scoring with knob consideration
   */
  buildScoringPrompt(state, draft) {
    const { brief, clientProfile } = state.inputs;
    const { knobs } = state;
    const languageContext = (clientProfile == null ? void 0 : clientProfile.primaryCommunicationLanguage) ? `

\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is ${clientProfile.primaryCommunicationLanguage}. Consider language appropriateness and cultural context when scoring.` : `

\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: The client's primary communication language is not specified, defaulting to US English.`;
    return `Score this social media post considering the 4-knob optimization settings:${languageContext}

Post: ${draft.post}
Platform: ${draft.platform}
Brief Objective: ${brief.objective || "Not specified"}

Current Knob Settings:
- Format Type: ${(knobs == null ? void 0 : knobs.formatType) || "Not set"}
- Hook Intensity: ${(knobs == null ? void 0 : knobs.hookIntensity) || "Not set"}
- Expertise Depth: ${(knobs == null ? void 0 : knobs.expertiseDepth) || "Not set"}
- Structure: ${(knobs == null ? void 0 : knobs.structure) ? `Length: ${knobs.structure.lengthLevel}, Scan: ${knobs.structure.scanDensity}` : "Not set"}

Client Profile: ${JSON.stringify(clientProfile, null, 2)}

Score on a 0-1 scale:
- readability: how easy to read and understand
- clarity: how clear the message is
- objectiveFit: how well it meets the campaign goal
- brandRisk: potential brand safety issues (0 = safe, 1 = risky)
- compliance: true if meets platform rules and legal requirements

Consider how well the content aligns with the knob settings:
- Does the format type match the content structure?
- Does the hook intensity match the opening line strength?
- Does the expertise depth match the technical level?
- Does the structure match the readability and scan-friendliness?
- Does the content use appropriate language and cultural context for the client?

Provide only the JSON response with these scores.`;
  }
  /**
   * Build prompt for strategy finalization with knob optimization
   */
  buildFinalizationPrompt(state) {
    const { inputs, strategy, knobs } = state;
    const { brief } = inputs;
    const platforms = (strategy == null ? void 0 : strategy.platforms) || ["linkedin"];
    const platformExamples = platforms.map((platform) => {
      switch (platform.toLowerCase()) {
        case "linkedin":
          return `"linkedin": "Tuesday 09:00 CET"`;
        case "twitter":
        case "x":
          return `"${platform}": "Monday 10:00 CET"`;
        case "instagram":
          return `"instagram": "Tuesday 12:00 CET"`;
        case "facebook":
          return `"facebook": "Monday 09:00 CET"`;
        default:
          return `"${platform}": "Tuesday 10:00 CET"`;
      }
    }).join(",\n      ");
    return `Finalize the strategy for this brief with 4-knob optimization:

Brief: ${brief.title}
Strategy: ${JSON.stringify(strategy, null, 2)}
Knob Settings: ${JSON.stringify(knobs, null, 2)}

IMPORTANT: Only include platforms that are specified in the strategy: ${platforms.join(", ")}

Provide a JSON response with the EXACT structure:

{
  "schedule": {
    "windows": {
      ${platformExamples}
    }
  },
  "deliverables": {
    "utm": "utm_source=platform&utm_medium=organic&utm_campaign=brief_title",
    "finalPosts": [],
    "rationale": "Explanation of timing and strategy decisions"
  }
}

CRITICAL REQUIREMENTS:
1. The schedule.windows object MUST ONLY contain platforms specified in the strategy: ${platforms.join(", ")}
2. DO NOT include platforms that are not in the strategy
3. Each platform should have ONE optimal posting time in CET timezone (not multiple times)
4. Times should be realistic for the target audience (e.g., 09:00-18:00 CET for business platforms)
5. The deliverables.utm should include proper UTM parameters for tracking
6. The rationale should explain why this specific time was chosen for each platform

Consider how the knob settings will impact performance:
- Format type affects content depth and engagement
- Hook intensity affects initial attention and see-more clicks
- Expertise depth affects audience retention and sharing
- Structure affects readability and platform optimization

Focus on optimal timing and tracking setup for the campaign.`;
  }
  /**
   * Generate fallback schedule when AI doesn't provide proper schedule data
   */
  generateFallbackSchedule(state) {
    var _a;
    const platforms = ((_a = state.strategy) == null ? void 0 : _a.platforms) || ["linkedin"];
    const schedule = {
      windows: {}
    };
    platforms.forEach((platform) => {
      switch (platform.toLowerCase()) {
        case "linkedin":
          schedule.windows[platform] = "Tuesday 09:00 CET";
          break;
        case "twitter":
        case "x":
          schedule.windows[platform] = "Monday 10:00 CET";
          break;
        case "instagram":
          schedule.windows[platform] = "Tuesday 12:00 CET";
          break;
        case "facebook":
          schedule.windows[platform] = "Monday 09:00 CET";
          break;
        default:
          schedule.windows[platform] = "Tuesday 10:00 CET";
      }
    });
    console.log("\u{1F4C5} Generated fallback schedule for platforms:", platforms, "Schedule:", schedule);
    return schedule;
  }
  /**
   * Prepare assets for the knob payload
   */
  prepareAssetsForKnobPayload(assets) {
    var _a, _b;
    const images = [];
    let pdfUrl = null;
    let slidesMarkdown = null;
    let videoUrl = null;
    for (const asset of assets) {
      if (asset.type === "image") {
        images.push(asset);
      } else if (asset.type === "document" && ((_a = asset.mimeType) == null ? void 0 : _a.includes("pdf"))) {
        pdfUrl = asset.url;
      } else if (asset.type === "document" && ((_b = asset.mimeType) == null ? void 0 : _b.includes("presentation"))) {
        slidesMarkdown = asset.url;
      } else if (asset.type === "video") {
        videoUrl = asset.url;
      }
    }
    return {
      images,
      pdfUrl,
      slidesMarkdown,
      videoUrl
    };
  }
}

var __defProp$1 = Object.defineProperty;
var __defNormalProp$1 = (obj, key, value) => key in obj ? __defProp$1(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField$1 = (obj, key, value) => __defNormalProp$1(obj, typeof key !== "symbol" ? key + "" : key, value);
class CopywriterAgent {
  constructor() {
    __publicField$1(this, "openai", getOpenAI());
    __publicField$1(this, "model", getDefaultChatModelName());
  }
  /**
   * Generate multiple post variants based on 4-knob strategy
   */
  async generateVariants(state, count = 3) {
    try {
      const { strategy, knobs } = state;
      if (!strategy || !knobs) {
        throw new Error("Strategy and knobs are required for variant generation");
      }
      if (!strategy.platforms || strategy.platforms.length === 0) {
        console.warn("\u26A0\uFE0F No platforms specified in strategy, defaulting to LinkedIn");
        strategy.platforms = ["linkedin"];
      }
      console.log("\u{1F504} Generating variants for platforms:", strategy.platforms);
      const variants = [];
      for (const platform of strategy.platforms) {
        console.log(`\u{1F504} Generating variants for ${platform}...`);
        const platformVariants = await this.generatePlatformVariants(
          state,
          platform,
          Math.ceil(count / strategy.platforms.length)
        );
        variants.push(...platformVariants);
        console.log(`\u2705 Generated ${platformVariants.length} variants for ${platform}`);
      }
      console.log(`\u2705 Total variants generated: ${variants.length}`);
      return variants;
    } catch (error) {
      console.error("Error in generateVariants:", error);
      throw error;
    }
  }
  /**
   * Revise drafts based on feedback from the digital marketeer
   */
  async reviseDrafts(state, drafts, revisionInstructions) {
    try {
      const revisedDrafts = [];
      for (const draft of drafts) {
        const instruction = revisionInstructions.find(
          (inst) => inst.variantId === draft.variantId || inst.variantId === draft.platform
        );
        if (instruction) {
          const revised = await this.reviseDraft(state, draft, instruction);
          revisedDrafts.push(revised);
        } else {
          revisedDrafts.push(draft);
        }
      }
      return revisedDrafts;
    } catch (error) {
      console.error("Error in reviseDrafts:", error);
      throw error;
    }
  }
  /**
   * Generate variants for a specific platform with 4-knob optimization
   */
  async generatePlatformVariants(state, platform, count) {
    var _a, _b, _c;
    const prompt = this.buildGenerationPrompt(state, platform, count);
    console.log("\n===== Copywriter Generation Prompt =====");
    console.log(`Platform: ${platform} | Variants: ${count}`);
    console.log(prompt);
    console.log("===== End Copywriter Generation Prompt =====\n");
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are a Copywriter agent specializing in social media content creation with 4-knob optimization. 
            Generate engaging, platform-optimized posts based on the provided strategy and knob settings.
            Always respond with valid JSON that can be parsed directly.
            
            CRITICAL LANGUAGE REQUIREMENT: You MUST write all content in ${((_a = state.inputs.clientProfile) == null ? void 0 : _a.primaryCommunicationLanguage) || "US English (default)"}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.
            
            The 4-knob system guides your content creation:
            1. formatType: Determines content structure and asset usage
            2. hookIntensity: Controls opening line strength and attention-grabbing
            3. expertiseDepth: Sets technical level and practitioner specificity
            4. structure: Defines length and scan-friendliness`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 1500
    });
    const content = (_c = (_b = response.choices[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
    if (!content) {
      throw new Error("No response content from OpenAI");
    }
    const variantsData = JSON.parse(content);
    const variants = variantsData.variants || [];
    return variants.map((variant, index) => {
      if (!state.knobs) {
        throw new Error("Knobs are required for variant generation");
      }
      const enhancedVariant = this.applyKnobConstraints(variant, state.knobs, state.knobPayload);
      return {
        ...enhancedVariant,
        platform,
        variantId: `${platform}-${index + 1}`,
        post: enhancedVariant.post,
        charCount: enhancedVariant.post.length,
        altText: enhancedVariant.altText || this.generateAltText(enhancedVariant.post, platform),
        formatType: state.knobs.formatType,
        usedAssets: enhancedVariant.usedAssets || [],
        sectionsCount: enhancedVariant.sectionsCount || 1,
        hookLine: enhancedVariant.hookLine || enhancedVariant.post.split("\n")[0]
      };
    });
  }
  /**
   * Apply knob constraints and format-specific rendering rules
   */
  applyKnobConstraints(variant, knobs, knobPayload) {
    let enhancedVariant = { ...variant };
    const clientPolicy = (knobPayload == null ? void 0 : knobPayload.clientPolicy) || {};
    enhancedVariant = this.applyFormatTypeRules(enhancedVariant, knobs.formatType);
    enhancedVariant = this.applyHookIntensityRules(enhancedVariant, knobs.hookIntensity, clientPolicy);
    enhancedVariant = this.applyExpertiseDepthRules(enhancedVariant, knobs.expertiseDepth);
    enhancedVariant = this.applyStructureRules(enhancedVariant, knobs.structure);
    enhancedVariant = this.applyClientPolicyRules(enhancedVariant, clientPolicy);
    return enhancedVariant;
  }
  /**
   * Apply format type specific rendering rules
   */
  applyFormatTypeRules(variant, formatType) {
    switch (formatType) {
      case "document_pdf":
        return {
          ...variant,
          post: this.structureAsDocument(variant.post),
          sectionsCount: this.countSections(variant.post),
          usedAssets: ["document_pdf"]
        };
      case "multi_image":
        return {
          ...variant,
          post: this.structureAsMultiImage(variant.post),
          sectionsCount: this.countSections(variant.post),
          usedAssets: ["image1", "image2", "image3"]
        };
      case "single_image":
        return {
          ...variant,
          post: this.structureAsSingleImage(variant.post),
          sectionsCount: 2,
          usedAssets: ["image1"]
        };
      case "video":
        return {
          ...variant,
          post: this.structureAsVideo(variant.post),
          sectionsCount: 3,
          usedAssets: ["video1"]
        };
      case "text":
      default:
        return {
          ...variant,
          post: this.structureAsText(variant.post),
          sectionsCount: this.countSections(variant.post),
          usedAssets: []
        };
    }
  }
  /**
   * Apply hook intensity rules
   */
  applyHookIntensityRules(variant, hookIntensity, clientPolicy) {
    let post = variant.post;
    const maxHookIntensity = clientPolicy.maxHookIntensity || 1;
    const actualHookIntensity = Math.min(hookIntensity, maxHookIntensity);
    if (actualHookIntensity > 0.7) {
      post = this.createBoldHook(post);
    } else if (actualHookIntensity > 0.4) {
      post = this.createBalancedHook(post);
    } else {
      post = this.createSubtleHook(post);
    }
    return {
      ...variant,
      post,
      hookLine: post.split("\n")[0]
    };
  }
  /**
   * Apply expertise depth rules
   */
  applyExpertiseDepthRules(variant, expertiseDepth) {
    let post = variant.post;
    if (expertiseDepth > 0.8) {
      post = this.enhanceTechnicalDepth(post);
    } else if (expertiseDepth > 0.4) {
      post = this.enhanceBusinessDepth(post);
    } else {
      post = this.enhanceGeneralAccessibility(post);
    }
    return { ...variant, post };
  }
  /**
   * Apply structure rules for length and scan density
   */
  applyStructureRules(variant, structure) {
    let post = variant.post;
    const { lengthLevel, scanDensity } = structure;
    if (lengthLevel < 0.4) {
      post = this.shortenContent(post, 600);
    } else if (lengthLevel > 0.7) {
      post = this.lengthenContent(post, 1200);
    }
    if (scanDensity > 0.7) {
      post = this.optimizeForScanning(post);
    } else {
      post = this.optimizeForNarrative(post);
    }
    return { ...variant, post };
  }
  /**
   * Apply client policy constraints
   */
  applyClientPolicyRules(variant, clientPolicy) {
    let post = variant.post;
    if (clientPolicy.emojiAllowed === false) {
      post = this.removeEmojis(post);
    }
    if (clientPolicy.voice === "formal") {
      post = this.makeFormal(post);
    } else if (clientPolicy.voice === "casual") {
      post = this.makeCasual(post);
    }
    if (clientPolicy.bannedClaims && Array.isArray(clientPolicy.bannedClaims)) {
      post = this.removeBannedClaims(post, clientPolicy.bannedClaims);
    }
    return { ...variant, post };
  }
  /**
   * Structure content as document format
   */
  structureAsDocument(content) {
    const lines = content.split("\n");
    const sections = ["\u{1F4CB} Overview", "\u{1F50D} Key Points", "\u{1F4A1} Insights", "\u{1F680} Action Items"];
    let structured = "";
    sections.forEach((section, index) => {
      if (lines[index]) {
        structured += `${section}
${lines[index]}

`;
      }
    });
    return structured.trim();
  }
  /**
   * Structure content as multi-image format
   */
  structureAsMultiImage(content) {
    const lines = content.split("\n");
    const sections = ["\u{1F3AF} Step 1", "\u{1F3AF} Step 2", "\u{1F3AF} Step 3", "\u2705 Result"];
    let structured = "";
    sections.forEach((section, index) => {
      if (lines[index]) {
        structured += `${section}
${lines[index]}

`;
      }
    });
    return structured.trim();
  }
  /**
   * Structure content as single image format
   */
  structureAsSingleImage(content) {
    const lines = content.split("\n");
    return `\u{1F5BC}\uFE0F ${lines[0]}

${lines.slice(1).join("\n")}`;
  }
  /**
   * Structure content as video format
   */
  structureAsVideo(content) {
    const lines = content.split("\n");
    return `\u{1F3A5} ${lines[0]}

${lines.slice(1).join("\n")}

\u25B6\uFE0F Watch the full video for more insights!`;
  }
  /**
   * Structure content as text format
   */
  structureAsText(content) {
    return content;
  }
  /**
   * Count sections in content
   */
  countSections(content) {
    const sectionMarkers = content.match(/[🎯📋🔍💡🚀✅]/gu);
    return sectionMarkers ? sectionMarkers.length : 1;
  }
  /**
   * Create bold hook for high intensity
   */
  createBoldHook(content) {
    const lines = content.split("\n");
    const firstLine = lines[0];
    if (firstLine.includes("?")) {
      return `\u{1F6A8} ${firstLine.toUpperCase()}

${lines.slice(1).join("\n")}`;
    } else {
      return `\u{1F4A5} ${firstLine}

${lines.slice(1).join("\n")}`;
    }
  }
  /**
   * Create balanced hook for medium intensity
   */
  createBalancedHook(content) {
    const lines = content.split("\n");
    const firstLine = lines[0];
    if (firstLine.includes("?")) {
      return `\u{1F914} ${firstLine}

${lines.slice(1).join("\n")}`;
    } else {
      return `\u{1F4A1} ${firstLine}

${lines.slice(1).join("\n")}`;
    }
  }
  /**
   * Create subtle hook for low intensity
   */
  createSubtleHook(content) {
    const lines = content.split("\n");
    const firstLine = lines[0];
    return `\u{1F4DA} ${firstLine}

${lines.slice(1).join("\n")}`;
  }
  /**
   * Enhance technical depth
   */
  enhanceTechnicalDepth(content) {
    return content.replace(
      /(strategy|approach|methodology)/gi,
      "strategic methodology"
    );
  }
  /**
   * Enhance business depth
   */
  enhanceBusinessDepth(content) {
    return content.replace(
      /(result|outcome)/gi,
      "business outcome"
    );
  }
  /**
   * Enhance general accessibility
   */
  enhanceGeneralAccessibility(content) {
    return content.replace(
      /(strategic methodology|business outcome)/gi,
      "approach"
    );
  }
  /**
   * Shorten content to target length
   */
  shortenContent(content, targetLength) {
    if (content.length <= targetLength) return content;
    const sentences = content.split(". ");
    let shortened = "";
    for (const sentence of sentences) {
      if ((shortened + sentence).length <= targetLength) {
        shortened += sentence + ". ";
      } else {
        break;
      }
    }
    return shortened.trim();
  }
  /**
   * Lengthen content to target length
   */
  lengthenContent(content, targetLength) {
    if (content.length >= targetLength) return content;
    const additions = [
      "This approach has been proven effective across multiple industries.",
      "Consider how this strategy aligns with your specific business goals.",
      "The key is to implement these insights consistently over time."
    ];
    let lengthened = content;
    for (const addition of additions) {
      if (lengthened.length < targetLength) {
        lengthened += "\n\n" + addition;
      }
    }
    return lengthened;
  }
  /**
   * Optimize content for scanning
   */
  optimizeForScanning(content) {
    const lines = content.split("\n");
    const optimized = lines.map((line) => {
      if (line.length > 80) {
        return line.replace(/([.!?])\s+/g, "$1\n");
      }
      return line;
    });
    return optimized.join("\n");
  }
  /**
   * Optimize content for narrative flow
   */
  optimizeForNarrative(content) {
    return content.replace(/\n{3,}/g, "\n\n");
  }
  /**
   * Remove emojis from content
   */
  removeEmojis(content) {
    return content.replace(/🎯/gu, "").replace(/📋/gu, "").replace(/🔍/gu, "").replace(/💡/gu, "").replace(/🚀/gu, "").replace(/✅/gu, "").replace(/🖼️/gu, "").replace(/🎥/gu, "").replace(/▶️/gu, "").replace(/🚨/gu, "").replace(/💥/gu, "").replace(/🤔/gu, "").replace(/📚/gu, "");
  }
  /**
   * Make content more formal
   */
  makeFormal(content) {
    return content.replace(/gonna/g, "going to").replace(/wanna/g, "want to").replace(/gotta/g, "got to");
  }
  /**
   * Make content more casual
   */
  makeCasual(content) {
    return content.replace(/going to/g, "gonna").replace(/want to/g, "wanna").replace(/got to/g, "gotta");
  }
  /**
   * Remove banned claims from content
   */
  removeBannedClaims(content, bannedClaims) {
    let cleaned = content;
    bannedClaims.forEach((claim) => {
      const regex = new RegExp(claim, "gi");
      cleaned = cleaned.replace(regex, "[removed]");
    });
    return cleaned;
  }
  /**
   * Revise a single draft based on feedback
   */
  async reviseDraft(state, draft, instruction) {
    var _a, _b, _c;
    const prompt = this.buildRevisionPrompt(state, draft, instruction);
    console.log("\n===== Copywriter Revision Prompt =====");
    console.log(`Platform: ${draft.platform} | Variant: ${draft.variantId || "unknown"}`);
    console.log(prompt);
    console.log("===== End Copywriter Revision Prompt =====\n");
    const response = await this.openai.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: "system",
          content: `You are revising social media content based on specific feedback. 
          Improve the post while maintaining its core message and platform optimization.
          Consider the 4-knob settings when making revisions.
          
          CRITICAL LANGUAGE REQUIREMENT: You MUST write all content in ${((_a = state.inputs.clientProfile) == null ? void 0 : _a.primaryCommunicationLanguage) || "US English (default)"}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.`
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      max_tokens: 800
    });
    const content = (_c = (_b = response.choices[0]) == null ? void 0 : _b.message) == null ? void 0 : _c.content;
    if (!content) {
      throw new Error("No revision response from OpenAI");
    }
    const revisedData = JSON.parse(content);
    return {
      ...draft,
      post: revisedData.post,
      altText: revisedData.altText || draft.altText,
      charCount: revisedData.post.length
    };
  }
  /**
   * Generate alt text for assets
   */
  generateAltText(post, platform) {
    const words = post.split(" ").slice(0, 10).join(" ");
    return `${platform} post: ${words}...`;
  }
  /**
   * Build prompt for variant generation with 4-knob system
   */
  buildGenerationPrompt(state, platform, count) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j, _k, _l, _m, _n, _o, _p;
    const { brief, clientProfile } = state.inputs;
    const { strategy, knobs } = state;
    const rules = platformRules[platform] || platformRules.linkedin;
    const languageInstruction = (clientProfile == null ? void 0 : clientProfile.primaryCommunicationLanguage) ? `

\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: Write ALL content in ${clientProfile.primaryCommunicationLanguage}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.` : "\n\n\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: Write ALL content in US English (default).";
    return `Generate ${count} social media post variants for ${platform.toUpperCase()} using the 4-knob optimization system.${languageInstruction}

Brief: ${brief.title}
Objective: ${brief.objective || "Not specified"}
Description: ${brief.description || "Not provided"}

Strategy:
- Structure: ${(strategy == null ? void 0 : strategy.structure) || "hook \u2192 insight \u2192 CTA"}
- Themes: ${((_a = strategy == null ? void 0 : strategy.themes) == null ? void 0 : _a.join(", ")) || "Not specified"}
- Hashtags: ${((_b = strategy == null ? void 0 : strategy.hashtags) == null ? void 0 : _b.join(", ")) || "Not specified"}

4-Knob Settings:
- Format Type: ${(knobs == null ? void 0 : knobs.formatType) || "Not set"} (affects content structure and asset usage)
- Hook Intensity: ${(knobs == null ? void 0 : knobs.hookIntensity) || "Not set"} (0.0-1.0 scale for opening line strength)
- Expertise Depth: ${(knobs == null ? void 0 : knobs.expertiseDepth) || "Not set"} (0.0-1.0 scale for technical level)
- Structure: ${(knobs == null ? void 0 : knobs.structure) ? `Length: ${knobs.structure.lengthLevel}, Scan: ${knobs.structure.scanDensity}` : "Not set"}

Platform Rules:
- Max Characters: ${rules.maxChars}
- Max Hashtags: ${rules.maxHashtags}
- Recommended Length: ${rules.recommendedLength}

${clientProfile ? `Client Profile:
- Primary Language: ${clientProfile.primaryCommunicationLanguage || "US English (default)"}
- Objectives: ${((_c = clientProfile.objectivesJson) == null ? void 0 : _c.primary) || "Increase brand awareness"}, ${((_d = clientProfile.objectivesJson) == null ? void 0 : _d.secondary) || "Drive engagement"}
- Target Audience: ${((_e = clientProfile.audiencesJson) == null ? void 0 : _e.target) || "General professional audience"}
- Demographics: ${((_f = clientProfile.audiencesJson) == null ? void 0 : _f.demographics) || "Professionals and decision makers"}
- Interests: ${Array.isArray((_g = clientProfile.audiencesJson) == null ? void 0 : _g.interests) && clientProfile.audiencesJson.interests.length > 0 ? clientProfile.audiencesJson.interests.join(", ") : "Professional development, industry trends"}
- Pain Points: ${Array.isArray((_h = clientProfile.audiencesJson) == null ? void 0 : _h.painPoints) && clientProfile.audiencesJson.painPoints.length > 0 ? clientProfile.audiencesJson.painPoints.join(", ") : "Information overload, time constraints"}
- Tone: ${((_i = clientProfile.toneJson) == null ? void 0 : _i.preset) || "Professional & Formal"}
- Voice: ${((_j = clientProfile.toneJson) == null ? void 0 : _j.voice) || "Balanced"}
${((_k = clientProfile.specialInstructionsJson) == null ? void 0 : _k.instructions) ? `- Special Instructions: ${clientProfile.specialInstructionsJson.instructions}` : ""}
${((_l = clientProfile.platformPrefsJson) == null ? void 0 : _l.primary) || ((_m = clientProfile.platformPrefsJson) == null ? void 0 : _m.secondary) ? `- Platform Preferences: ${[(_n = clientProfile.platformPrefsJson) == null ? void 0 : _n.primary, (_o = clientProfile.platformPrefsJson) == null ? void 0 : _o.secondary].filter(Boolean).join(", ")}` : ""}
${((_p = clientProfile.platformPrefsJson) == null ? void 0 : _p.focus) ? `- Focus: ${clientProfile.platformPrefsJson.focus}` : ""}
${(() => {
      var _a2, _b2, _c2;
      const banned = Array.isArray((_a2 = clientProfile.guardrailsJson) == null ? void 0 : _a2.banned) && clientProfile.guardrailsJson.banned.length > 0 ? `Banned topics (${clientProfile.guardrailsJson.banned.join(", ")})` : "";
      const sensitive = Array.isArray((_b2 = clientProfile.guardrailsJson) == null ? void 0 : _b2.sensitive) && clientProfile.guardrailsJson.sensitive.length > 0 ? `Sensitive topics (${clientProfile.guardrailsJson.sensitive.join(", ")})` : "";
      const required = Array.isArray((_c2 = clientProfile.guardrailsJson) == null ? void 0 : _c2.required) && clientProfile.guardrailsJson.required.length > 0 ? `Required elements (${clientProfile.guardrailsJson.required.join(", ")})` : "";
      const parts = [banned, sensitive, required].filter(Boolean);
      return parts.length ? `- Guardrails: ${parts.join(", ")}` : "";
    })()}` : "Client Profile: Not provided"}

Make the first line the headline (this is also the hook). After the headline, insert a single blank line, then the body. Do not include separate headline options. Provide a JSON response with:
{
  "variants": [
    {
      "post": "Headline (first line) followed by a blank line, then the body",
      "altText": "description for image/video"
    }
  ]
}

Focus on creating engaging, platform-optimized content that aligns with the 4-knob settings:
- Format type should guide content structure and asset usage
- Hook intensity should match opening line strength
- Expertise depth should match technical level
- Structure should optimize for length and scan-friendliness

\u{1F6A8} REMEMBER: ALL content MUST be written in ${(clientProfile == null ? void 0 : clientProfile.primaryCommunicationLanguage) || "US English (default)"} - this is the client's primary communication language!`;
  }
  /**
   * Build prompt for draft revision with knob consideration
   */
  buildRevisionPrompt(state, draft, instruction) {
    var _a, _b, _c, _d, _e, _f;
    const { brief, clientProfile } = state.inputs;
    const { knobs } = state;
    const languageInstruction = (clientProfile == null ? void 0 : clientProfile.primaryCommunicationLanguage) ? `

\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: Write ALL content in ${clientProfile.primaryCommunicationLanguage}. This is the client's primary communication language and all content must be culturally and linguistically appropriate for this language.` : "\n\n\u{1F6A8} CRITICAL LANGUAGE REQUIREMENT: Write ALL content in US English (default).";
    return `Revise this social media post based on the feedback while maintaining 4-knob optimization and client profile alignment:${languageInstruction}

Original Post: ${draft.post}
Platform: ${draft.platform}
Brief Objective: ${brief.objective || "Not specified"}

Current Knob Settings:
- Format Type: ${(knobs == null ? void 0 : knobs.formatType) || "Not set"}
- Hook Intensity: ${(knobs == null ? void 0 : knobs.hookIntensity) || "Not set"}
- Expertise Depth: ${(knobs == null ? void 0 : knobs.expertiseDepth) || "Not set"}
- Structure: ${(knobs == null ? void 0 : knobs.structure) ? `Length: ${knobs.structure.lengthLevel}, Scan: ${knobs.structure.scanDensity}` : "Not set"}

${clientProfile ? `Client Profile Context:
- Primary Language: ${clientProfile.primaryCommunicationLanguage || "US English (default)"}
- Objectives: ${((_a = clientProfile.objectivesJson) == null ? void 0 : _a.primary) || "Increase brand awareness"}, ${((_b = clientProfile.objectivesJson) == null ? void 0 : _b.secondary) || "Drive engagement"}
- Target Audience: ${((_c = clientProfile.audiencesJson) == null ? void 0 : _c.target) || "General professional audience"}
- Tone: ${((_d = clientProfile.toneJson) == null ? void 0 : _d.preset) || "Professional & Formal"}
- Voice: ${((_e = clientProfile.toneJson) == null ? void 0 : _e.voice) || "Balanced"}
${((_f = clientProfile.specialInstructionsJson) == null ? void 0 : _f.instructions) ? `- Special Instructions: ${clientProfile.specialInstructionsJson.instructions}` : ""}
${(() => {
      var _a2, _b2;
      const banned = Array.isArray((_a2 = clientProfile.guardrailsJson) == null ? void 0 : _a2.banned) && clientProfile.guardrailsJson.banned.length > 0 ? `Banned topics (${clientProfile.guardrailsJson.banned.join(", ")})` : "";
      const sensitive = Array.isArray((_b2 = clientProfile.guardrailsJson) == null ? void 0 : _b2.sensitive) && clientProfile.guardrailsJson.sensitive.length > 0 ? `Sensitive topics (${clientProfile.guardrailsJson.sensitive.join(", ")})` : "";
      const parts = [banned, sensitive].filter(Boolean);
      return parts.length ? `- Guardrails: ${parts.join(", ")}` : "";
    })()}` : "Client Profile: Not provided"}

Feedback: ${instruction.feedback}
Suggested Changes: ${Array.isArray(instruction.suggestedChanges) ? instruction.suggestedChanges.join(", ") : "Not specified"}

Ensure the first line is the headline (the hook), followed by a single blank line, then the body. Provide a JSON response with:
{
  "post": "revised post text with a strong first-line headline and a blank line before the body",
  "altText": "revised alt text"
}

Maintain the core message while addressing the feedback. Ensure the post remains optimized for the platform, aligns with the 4-knob settings, and respects the client's tone, voice, and guardrails.

\u{1F6A8} REMEMBER: ALL content MUST be written in ${(clientProfile == null ? void 0 : clientProfile.primaryCommunicationLanguage) || "US English (default)"} - this is the client's primary communication language!`;
  }
}

var __defProp = Object.defineProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
class AgentOrchestrator {
  constructor() {
    __publicField(this, "marketeer");
    __publicField(this, "copywriter");
    this.marketeer = new DigitalMarketeerAgent();
    this.copywriter = new CopywriterAgent();
  }
  /**
   * Execute the complete agent workflow with 4-knob optimization
   */
  async executeWorkflow(initialState) {
    try {
      let state = { ...initialState };
      let revisionCycle = 0;
      console.log("\u{1F504} Planning strategy with 4-knob optimization...");
      const strategyResult = await this.marketeer.planStrategy(state);
      if (!strategyResult.success) {
        throw new Error(`Strategy planning failed: ${strategyResult.error}`);
      }
      state = { ...state, ...strategyResult.state };
      console.log("\u2705 Strategy planned with knobs:", state.knobs);
      console.log("\u{1F50D} State after strategy planning:", {
        hasKnobs: !!state.knobs,
        knobsKeys: state.knobs ? Object.keys(state.knobs) : "none",
        hasStrategy: !!state.strategy,
        strategyKeys: state.strategy ? Object.keys(state.strategy) : "none",
        hasAssetAnalysis: !!state.assetAnalysis,
        stateKeys: Object.keys(state)
      });
      if (!state.strategy) {
        state.strategy = {
          platforms: ["linkedin"],
          structure: "hook \u2192 insight \u2192 CTA",
          themes: ["professional", "educational"],
          hashtags: ["#business", "#strategy"],
          objective: state.objective || "Increase brand awareness"
        };
      }
      if (!state.strategy.platforms || state.strategy.platforms.length === 0) {
        state.strategy.platforms = ["linkedin"];
      }
      console.log("\u2705 Strategy configured with platforms:", state.strategy.platforms);
      if (state.knobs && state.inputs.clientProfile) {
        const knobValidation = this.validateKnobCompliance(state.knobs, state.inputs.clientProfile);
        if (!knobValidation.isValid) {
          console.warn("\u26A0\uFE0F Knob validation warnings:", knobValidation.warnings);
        }
      }
      console.log("\u{1F504} Generating initial drafts with 4-knob settings...");
      const initialDrafts = await this.copywriter.generateVariants(
        state,
        agentThresholds.minVariantsToGenerate
      );
      state.drafts = initialDrafts;
      console.log(`\u2705 Generated ${initialDrafts.length} initial drafts with knob optimization`);
      while (revisionCycle < agentThresholds.maxRevisionCycles) {
        console.log(`\u{1F504} Evaluation cycle ${revisionCycle + 1} with knob effectiveness...`);
        const evaluationResult = await this.marketeer.evaluateDrafts(state, state.drafts);
        if (!evaluationResult.success) {
          throw new Error(`Draft evaluation failed: ${evaluationResult.error}`);
        }
        state = { ...state, ...evaluationResult.state };
        if (!evaluationResult.instructions || evaluationResult.instructions.length === 0) {
          console.log("\u2705 All drafts meet quality standards with knob optimization");
          break;
        }
        const allDraftsMeetThreshold = state.drafts.every((draft) => {
          const score = state.scores[draft.variantId || draft.platform];
          return score && score.composite >= agentThresholds.minCompositeScore && score.brandRisk <= agentThresholds.maxBrandRisk && score.compliance;
        });
        if (allDraftsMeetThreshold) {
          console.log("\u2705 All drafts meet quality thresholds with knob optimization");
          break;
        }
        console.log(`\u{1F504} Revising ${evaluationResult.instructions.length} drafts with knob constraints...`);
        const revisedDrafts = await this.copywriter.reviseDrafts(
          state,
          state.drafts,
          evaluationResult.instructions
        );
        state.drafts = revisedDrafts;
        revisionCycle++;
        console.log(`\u2705 Revision cycle ${revisionCycle} completed with knob optimization`);
      }
      console.log("\u{1F504} Finalizing strategy with knob optimization insights...");
      const finalizationResult = await this.marketeer.finalizeStrategy(state);
      if (!finalizationResult.success) {
        throw new Error(`Strategy finalization failed: ${finalizationResult.error}`);
      }
      state = { ...state, ...finalizationResult.state };
      console.log("\u2705 Strategy finalized with knob optimization");
      return {
        success: true,
        finalState: state
      };
    } catch (error) {
      console.error("\u274C Workflow execution failed:", error);
      return {
        success: false,
        finalState: initialState,
        error: error instanceof Error ? error.message : "Unknown workflow error"
      };
    }
  }
  /**
   * Execute the complete agent workflow with 4-knob optimization and progress tracking
   */
  async executeWorkflowWithProgress(initialState, onProgress) {
    var _a, _b, _c;
    try {
      let state = { ...initialState };
      let revisionCycle = 0;
      const updateProgress = (step, stepNumber, totalSteps, details) => {
        const progress = {
          currentStep: step,
          stepNumber,
          totalSteps,
          percentage: Math.round(stepNumber / totalSteps * 100),
          details,
          timestamp: Date.now()
        };
        if (onProgress) {
          onProgress(progress);
        }
        return progress;
      };
      console.log("\u{1F504} Planning strategy with 4-knob optimization...");
      updateProgress("Planning Strategy", 1, 4, "Analyzing brief and determining content strategy with 4-knob optimization");
      const strategyResult = await this.marketeer.planStrategy(state);
      if (!strategyResult.success) {
        throw new Error(`Strategy planning failed: ${strategyResult.error}`);
      }
      state = { ...state, ...strategyResult.state };
      console.log("\u2705 Strategy planned with knobs:", state.knobs);
      if (!state.strategy) {
        state.strategy = {
          platforms: ["linkedin"],
          structure: "hook \u2192 insight \u2192 CTA",
          themes: ["professional", "educational"],
          hashtags: ["#business", "#strategy"],
          objective: state.objective || "Increase brand awareness"
        };
      }
      if (!state.strategy.platforms || state.strategy.platforms.length === 0) {
        state.strategy.platforms = ["linkedin"];
      }
      console.log("\u2705 Strategy configured with platforms:", state.strategy.platforms);
      if (state.knobs && state.inputs.clientProfile) {
        const knobValidation = this.validateKnobCompliance(state.knobs, state.inputs.clientProfile);
        if (!knobValidation.isValid) {
          console.warn("\u26A0\uFE0F Knob validation warnings:", knobValidation.warnings);
        }
      }
      console.log("\u{1F504} Generating initial drafts with 4-knob settings...");
      updateProgress("Generating Content", 2, 4, "Creating content variants optimized with 4-knob settings");
      const initialDrafts = await this.copywriter.generateVariants(
        state,
        agentThresholds.minVariantsToGenerate
      );
      state.drafts = initialDrafts;
      console.log(`\u2705 Generated ${initialDrafts.length} initial drafts with knob optimization`);
      updateProgress("Evaluating & Revising", 3, 4, "Assessing content quality and optimizing with AI feedback");
      while (revisionCycle < agentThresholds.maxRevisionCycles) {
        console.log(`\u{1F504} Evaluation cycle ${revisionCycle + 1} with knob effectiveness...`);
        const evaluationResult = await this.marketeer.evaluateDrafts(state, state.drafts);
        if (!evaluationResult.success) {
          throw new Error(`Draft evaluation failed: ${evaluationResult.error}`);
        }
        state = { ...state, ...evaluationResult.state };
        if (!evaluationResult.instructions || evaluationResult.instructions.length === 0) {
          console.log("\u2705 All drafts meet quality standards with knob optimization");
          break;
        }
        const allDraftsMeetThreshold = state.drafts.every((draft) => {
          const score = state.scores[draft.variantId || draft.platform];
          return score && score.composite >= agentThresholds.minCompositeScore && score.brandRisk <= agentThresholds.maxBrandRisk && score.compliance;
        });
        if (allDraftsMeetThreshold) {
          console.log("\u2705 All drafts meet quality thresholds with knob optimization");
          break;
        }
        console.log(`\u{1F504} Revising ${evaluationResult.instructions.length} drafts with knob constraints...`);
        const revisedDrafts = await this.copywriter.reviseDrafts(
          state,
          state.drafts,
          evaluationResult.instructions
        );
        state.drafts = revisedDrafts;
        revisionCycle++;
        console.log(`\u2705 Revision cycle ${revisionCycle} completed with knob optimization`);
      }
      console.log("\u{1F504} Finalizing strategy with knob optimization insights...");
      updateProgress("Finalizing Strategy", 4, 4, "Optimizing final strategy and preparing content for publishing");
      const finalizationResult = await this.marketeer.finalizeStrategy(state);
      if (!finalizationResult.success) {
        throw new Error(`Strategy finalization failed: ${finalizationResult.error}`);
      }
      state = { ...state, ...finalizationResult.state };
      console.log("\u2705 Strategy finalized with knob optimization");
      console.log("\u{1F4C5} Schedule data received:", {
        hasSchedule: !!state.schedule,
        scheduleKeys: state.schedule ? Object.keys(state.schedule) : "none",
        hasWindows: ((_a = state.schedule) == null ? void 0 : _a.windows) ? "yes" : "no",
        windowsKeys: ((_b = state.schedule) == null ? void 0 : _b.windows) ? Object.keys(state.schedule.windows) : "none"
      });
      const finalProgress = updateProgress(
        "Workflow Complete",
        4,
        4,
        `Generated ${((_c = state.drafts) == null ? void 0 : _c.length) || 0} content variants with 4-knob optimization`
      );
      return {
        success: true,
        finalState: state,
        progress: finalProgress
      };
    } catch (error) {
      console.error("\u274C Progressive workflow execution failed:", error);
      return {
        success: false,
        finalState: initialState,
        error: error instanceof Error ? error.message : "Unknown workflow error",
        progress: {
          currentStep: "Error",
          stepNumber: 0,
          totalSteps: 4,
          percentage: 0,
          details: error instanceof Error ? error.message : "Unknown error",
          timestamp: Date.now()
        }
      };
    }
  }
  /**
   * Execute just the strategy planning phase with 4-knob optimization
   */
  async planStrategy(state) {
    return await this.marketeer.planStrategy(state);
  }
  /**
   * Execute just the draft generation phase with knob payload
   */
  async generateDrafts(state, count = 3) {
    return await this.copywriter.generateVariants(state, count);
  }
  /**
   * Execute just the draft evaluation phase with knob effectiveness
   */
  async evaluateDrafts(state, drafts) {
    return await this.marketeer.evaluateDrafts(state, drafts);
  }
  /**
   * Execute just the strategy finalization phase with knob insights
   */
  async finalizeStrategy(state) {
    return await this.marketeer.finalizeStrategy(state);
  }
  /**
   * Validate knob compliance with client policy and constraints
   */
  validateKnobCompliance(knobs, clientProfile) {
    const warnings = [];
    const clientPolicy = (clientProfile == null ? void 0 : clientProfile.clientPolicy) || {};
    if (!knobs.formatType || !["text", "single_image", "multi_image", "document_pdf", "video"].includes(knobs.formatType)) {
      warnings.push("Invalid format type specified");
    }
    if (knobs.hookIntensity < 0 || knobs.hookIntensity > 1) {
      warnings.push("Hook intensity must be between 0.0 and 1.0");
    }
    if (clientPolicy.maxHookIntensity !== void 0 && knobs.hookIntensity > clientPolicy.maxHookIntensity) {
      warnings.push(`Hook intensity ${knobs.hookIntensity} exceeds client maximum ${clientPolicy.maxHookIntensity}`);
    }
    if (knobs.expertiseDepth < 0 || knobs.expertiseDepth > 1) {
      warnings.push("Expertise depth must be between 0.0 and 1.0");
    }
    if (!knobs.structure || typeof knobs.structure !== "object") {
      warnings.push("Structure must be an object with lengthLevel and scanDensity");
    } else {
      if (knobs.structure.lengthLevel < 0 || knobs.structure.lengthLevel > 1) {
        warnings.push("Structure lengthLevel must be between 0.0 and 1.0");
      }
      if (knobs.structure.scanDensity < 0 || knobs.structure.scanDensity > 1) {
        warnings.push("Structure scanDensity must be between 0.0 and 1.0");
      }
    }
    if (knobs.formatType === "multi_image" && (!(clientProfile == null ? void 0 : clientProfile.assets) || clientProfile.assets.length < 3)) {
      warnings.push("Multi-image format requires at least 3 assets");
    }
    if (knobs.formatType === "document_pdf" && (!(clientProfile == null ? void 0 : clientProfile.assets) || !clientProfile.assets.some((a) => a.type === "document"))) {
      warnings.push("Document PDF format requires document assets");
    }
    if (knobs.formatType === "video" && (!(clientProfile == null ? void 0 : clientProfile.assets) || !clientProfile.assets.some((a) => a.type === "video"))) {
      warnings.push("Video format requires video assets");
    }
    return {
      isValid: warnings.length === 0,
      warnings
    };
  }
  /**
   * Get workflow status and metrics with knob effectiveness
   */
  getWorkflowMetrics(state) {
    var _a;
    const metrics = {
      totalDrafts: ((_a = state.drafts) == null ? void 0 : _a.length) || 0,
      averageScore: 0,
      revisionCycles: 0,
      qualityStatus: "unknown",
      knobEffectiveness: {
        formatType: "unknown",
        hookIntensity: "unknown",
        expertiseDepth: "unknown",
        structure: "unknown"
      },
      complianceStatus: "unknown"
    };
    if (state.scores && Object.keys(state.scores).length > 0) {
      const scores = Object.values(state.scores);
      metrics.averageScore = scores.reduce((sum, score) => sum + (score.composite || 0), 0) / scores.length;
      const allHighQuality = scores.every(
        (score) => score.composite >= agentThresholds.minCompositeScore && score.brandRisk <= agentThresholds.maxBrandRisk && score.compliance
      );
      metrics.qualityStatus = allHighQuality ? "high" : "needs_improvement";
      if (state.knobs) {
        metrics.knobEffectiveness = this.analyzeKnobEffectiveness(state.knobs, scores);
      }
      const complianceScores = scores.map((score) => score.compliance);
      const complianceRate = complianceScores.filter(Boolean).length / complianceScores.length;
      metrics.complianceStatus = complianceRate > 0.8 ? "excellent" : complianceRate > 0.6 ? "good" : complianceRate > 0.4 ? "fair" : "poor";
    }
    return metrics;
  }
  /**
   * Analyze knob effectiveness based on scores
   */
  analyzeKnobEffectiveness(knobs, scores) {
    return {
      formatType: this.assessFormatTypeEffectiveness(knobs.formatType, scores),
      hookIntensity: this.assessHookIntensityEffectiveness(knobs.hookIntensity, scores),
      expertiseDepth: this.assessExpertiseDepthEffectiveness(knobs.expertiseDepth, scores),
      structure: this.assessStructureEffectiveness(knobs.structure, scores)
    };
  }
  /**
   * Assess format type effectiveness
   */
  assessFormatTypeEffectiveness(formatType, scores) {
    const avgScore = scores.reduce((sum, score) => sum + (score.composite || 0), 0) / scores.length;
    if (avgScore > 0.8) return "excellent";
    if (avgScore > 0.6) return "good";
    if (avgScore > 0.4) return "fair";
    return "poor";
  }
  /**
   * Assess hook intensity effectiveness
   */
  assessHookIntensityEffectiveness(hookIntensity, scores) {
    const readabilityScores = scores.map((score) => score.readability || 0);
    const avgReadability = readabilityScores.reduce((sum, score) => sum + score, 0) / readabilityScores.length;
    if (hookIntensity > 0.7 && avgReadability > 0.8) return "excellent";
    if (hookIntensity > 0.4 && avgReadability > 0.6) return "good";
    if (hookIntensity > 0.2 && avgReadability > 0.4) return "fair";
    return "poor";
  }
  /**
   * Assess expertise depth effectiveness
   */
  assessExpertiseDepthEffectiveness(expertiseDepth, scores) {
    const objectiveFitScores = scores.map((score) => score.objectiveFit || 0);
    const avgObjectiveFit = objectiveFitScores.reduce((sum, score) => sum + score, 0) / objectiveFitScores.length;
    if (expertiseDepth > 0.8 && avgObjectiveFit > 0.8) return "excellent";
    if (expertiseDepth > 0.4 && avgObjectiveFit > 0.6) return "good";
    if (expertiseDepth > 0.2 && avgObjectiveFit > 0.4) return "fair";
    return "poor";
  }
  /**
   * Assess structure effectiveness
   */
  assessStructureEffectiveness(structure, scores) {
    const readabilityScores = scores.map((score) => score.readability || 0);
    const avgReadability = readabilityScores.reduce((sum, score) => sum + score, 0) / readabilityScores.length;
    if (structure.scanDensity > 0.7 && avgReadability > 0.8) return "excellent";
    if (structure.scanDensity > 0.4 && avgReadability > 0.6) return "good";
    if (structure.scanDensity > 0.2 && avgReadability > 0.4) return "fair";
    return "poor";
  }
  /**
   * Get knob optimization recommendations
   */
  getKnobOptimizationRecommendations(state) {
    const recommendations = [];
    const metrics = this.getWorkflowMetrics(state);
    if (metrics.knobEffectiveness.hookIntensity === "poor") {
      recommendations.push("Consider reducing hook intensity for better readability");
    }
    if (metrics.knobEffectiveness.expertiseDepth === "poor") {
      recommendations.push("Adjust expertise depth to better match audience and objective");
    }
    if (metrics.knobEffectiveness.structure === "poor") {
      recommendations.push("Optimize structure for better scan-friendliness");
    }
    if (metrics.complianceStatus === "poor") {
      recommendations.push("Review content for compliance with platform rules and client policy");
    }
    const priority = recommendations.length > 2 ? "high" : recommendations.length > 1 ? "medium" : "low";
    return { recommendations, priority };
  }
}

export { AgentOrchestrator as A };
//# sourceMappingURL=orchestrator.mjs.map
