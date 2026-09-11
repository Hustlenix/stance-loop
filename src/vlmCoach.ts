// Local VLM Coaching Adapter (FormCoach pattern)
// Connects to Ollama running Qwen2.5-VL or LLaVA for contextual form feedback
// Pure TypeScript: zero React/DOM imports. Portable core for web/native.

import type { DrillId } from "./types";
import type { MediaPipeLandmarks } from "./exerciseDefinitions/types";
import { CueId, cueRuleForId, cueTextForVoice, DRILL_TITLES, type CueVoice } from "./rules";

export type VLMProvider = "qwen2.5vl" | "llava" | "llava-next";
export type VLMModel = "qwen2.5vl:7b" | "llava:7b" | "llava:13b" | "llava-next:7b";

export interface VLMConfig {
  provider: VLMProvider;
  model: VLMModel;
  baseUrl: string; // e.g., "http://localhost:11434"
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
}

export const DEFAULT_VLM_CONFIG: VLMConfig = {
  provider: "qwen2.5vl",
  model: "qwen2.5vl:7b",
  baseUrl: "http://localhost:11434",
  timeoutMs: 10000,
  temperature: 0.3,
  maxTokens: 150,
};

export interface CoachingContext {
  drillId: DrillId;
  cueId: CueId;
  cueText: string;
  ruleName: string;
  currentAngle?: number;
  targetAngle?: [number, number];
  landmarks?: MediaPipeLandmarks;
  voice: CueVoice;
  repCount: number;
  holdSeconds: number;
  previousFeedback?: string[];
}

export interface VLMResponse {
  feedback: string;
  confidence: number;
  shouldSpeak: boolean;
}

/** Build the VLM prompt for form correction */
export function buildCoachingPrompt(context: CoachingContext): string {
  const drillTitle = DRILL_TITLES[context.drillId as DrillId];
  const angleInfo = context.currentAngle !== undefined && context.targetAngle !== undefined
    ? `\nCurrent angle: ${Math.round(context.currentAngle)}° (target: ${context.targetAngle[0]}°-${context.targetAngle[1]}°)`
    : "";

  const voiceStyle = context.voice === "direct"
    ? "Be concise, direct, and authoritative. Use imperative mood."
    : "Be calm, encouraging, and supportive. Use gentle guidance.";

  return `You are an expert ${drillTitle} coach. A user is performing this exercise and needs real-time form correction.

Exercise: ${drillTitle}
Detected fault: ${context.cueText}
Rule violated: ${context.ruleName}${angleInfo}
Current rep: ${context.repCount}, Hold: ${context.holdSeconds}s
${context.previousFeedback && context.previousFeedback.length > 0 ? `Previous feedback given: ${context.previousFeedback.join("; ")}` : ""}

${voiceStyle}

Provide ONE concise correction (max 2 sentences, under 160 chars) that tells the user exactly what to fix RIGHT NOW. Focus on the specific mechanical adjustment, not generic advice. Never use medical, injury, or safety language. Never say "be careful" or "don't hurt yourself."

Response format: Just the coaching text, no labels or prefixes.`;
}

/** Call Ollama API for VLM coaching */
export async function callOllamaVLM(
  prompt: string,
  config: VLMConfig = DEFAULT_VLM_CONFIG
): Promise<string> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        prompt,
        stream: false,
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
        },
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status}`);
    }

    const data = await response.json();
    return data.response?.trim() ?? "";
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("VLM request timeout");
    }
    throw error;
  }
}

/** Check if Ollama is available and model is loaded */
export async function checkOllamaHealth(config: VLMConfig = DEFAULT_VLM_CONFIG): Promise<boolean> {
  try {
    const response = await fetch(`${config.baseUrl}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.models?.some((m: { name: string }) => m.name.includes(config.model.split(":")[0])) ?? false;
  } catch {
    return false;
  }
}

/** Main coaching function: generates contextual feedback from VLM */
export async function generateVLMCorrection(
  context: CoachingContext,
  config: VLMConfig = DEFAULT_VLM_CONFIG
): Promise<VLMResponse> {
  try {
    const prompt = buildCoachingPrompt(context);
    const feedback = await callOllamaVLM(prompt, config);

    // Sanitize: limit length, remove unwanted phrases
    const sanitized = feedback
      .replace(/^(feedback:|correction:|coaching:)\s*/i, "")
      .slice(0, 180)
      .trim();

    // Determine if we should speak (avoid repeating recent feedback)
    const shouldSpeak = !context.previousFeedback?.includes(sanitized);

    return {
      feedback: sanitized,
      confidence: 0.85, // VLM confidence estimate
      shouldSpeak,
    };
  } catch (error) {
    // Fallback to rule-based cue text if VLM fails
    return {
      feedback: context.cueText,
      confidence: 0.5,
      shouldSpeak: true,
    };
  }
}

/** Pre-built prompts for common fault patterns (faster than full VLM) */
export const QUICK_PROMPTS: Record<string, (ctx: Partial<CoachingContext>) => string> = {
  "pushup-hips-sag": () => "Engage core — posterior pelvic tilt, straight line from shoulders to heels.",
  "pushup-hips-pike": () => "Lower hips — straight line from head to heels, don't pike up.",
  "pushup-elbow-flare": () => "Tuck elbows 45° from body — protect shoulders.",
  "pushup-shallow": () => "Chest to floor — full range of motion.",
  "handstand-banana": () => "Posterior pelvic tilt — flatten lower back, open shoulders.",
  "handstand-shoulders-closed": () => "Push floor away — shoulders to ears, fully open.",
  "handstand-hips-pike": () => "Squeeze glutes — hips over shoulders, straight line.",
  "jab-cross-dropping-hands": () => "Hands at cheek level — chin protected always.",
  "jab-cross-telegraph": () => "No wind-up — jab straight from guard.",
  "jab-cross-no-rotation": () => "Rotate hips and shoulders — power from ground up.",
  "jab-cross-leaning": () => "Stay centered — weight 50/50, don't reach.",
  "squat-knee-valgus": () => "Knees out — track over toes, screw feet into floor.",
  "squat-shallow": () => "Hip crease below knee — sit back deeper.",
  "squat-forward-lean": () => "Chest up — weight in heels, not toes.",
  "plank-hips-sag": () => "Tuck tailbone — posterior pelvic tilt, engage glutes.",
  "plank-hips-pike": () => "Lower hips — straight line shoulders to heels.",
};

/** Get quick rule-based feedback (no VLM call needed) */
export function getQuickFeedback(cueId: CueId): string | undefined {
  return QUICK_PROMPTS[cueId]?.({});
}

/** Hybrid coaching: try VLM first, fall back to quick prompts, then rule text */
export async function hybridCoaching(
  context: CoachingContext,
  config: VLMConfig = DEFAULT_VLM_CONFIG
): Promise<VLMResponse> {
  // 1. Try quick prompt (instant, no network)
  const quick = getQuickFeedback(context.cueId);
  if (quick) {
    return { feedback: quick, confidence: 0.9, shouldSpeak: true };
  }

  // 2. Try VLM (contextual, intelligent)
  try {
    const vlmResult = await generateVLMCorrection(context, config);
    if (vlmResult.feedback && vlmResult.feedback.length > 10) {
      return vlmResult;
    }
  } catch {
    // VLM failed, continue to fallback
  }

  // 3. Fallback to rule-based cue text
  return {
    feedback: context.cueText,
    confidence: 0.5,
    shouldSpeak: true,
  };
}