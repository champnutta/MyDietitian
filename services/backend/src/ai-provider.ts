import type {
  AiAgentFallbackConfig,
  AiAgentConfig,
  AnalyzeExerciseRequest,
  AnalyzeMealRequest,
  BiaAnalysisResult,
  CoachConsultationRequest,
  ExerciseAnalysisResult,
  ImageClassificationResult,
  MealAnalysisResult
} from "./contracts.js";
import { db } from "./runtime.js";

const DEFAULT_AGENT_BASE = {
  provider: "gemini",
  model: "gemini-3.5-flash",
  temperature: 0.2,
  enabled: true,
  timeoutMs: 20_000,
  maxAttempts: 2
} satisfies Omit<AiAgentConfig, "agentId" | "promptVersion">;

type GeminiPart = {
  text?: string;
  inline_data?: {
    mime_type: string;
    data: string;
  };
};

type GeminiGenerationConfig = {
  temperature?: number;
  response_mime_type?: "application/json";
  maxOutputTokens?: number;
};

// Thai output is token-dense, so a coaching answer (especially a 3-option menu
// recommendation) easily overran the old 1024-token ceiling and got cut off
// mid-sentence. This gives ample headroom while staying under LINE's 4900-char
// message cap.
const COACH_MAX_OUTPUT_TOKENS = 2048;

export class MealImageUnclearError extends Error {
  constructor(message = "The image does not contain enough recognizable food detail for a reliable estimate") {
    super(message);
    this.name = "MealImageUnclearError";
  }
}

type AiProviderApiKeys = {
  gemini?: string;
  anthropic?: string;
  openai?: string;
};

const DEFAULT_AGENT_PROMPT_VERSION: Record<string, string> = {
  mealAnalysis: "meal-v1",
  exerciseAnalysis: "exercise-v1",
  biaAnalysis: "bia-v1",
  coachConsultation: "coach-v1"
};

export async function getAiAgentConfig(agentId: string): Promise<AiAgentConfig> {
  const defaultAgent = getDefaultAgent(agentId);
  const snap = await db.collection("aiAgents").doc(agentId).get();
  if (!snap.exists) {
    return defaultAgent;
  }

  const data = snap.data() ?? {};
  return {
    agentId,
    provider: normalizeAiProvider(data.provider),
    model: String(data.model ?? defaultAgent.model),
    promptVersion: String(data.promptVersion ?? defaultAgent.promptVersion),
    temperature: Number(data.temperature ?? defaultAgent.temperature),
    enabled: data.enabled !== false,
    timeoutMs: normalizePositiveNumber(data.timeoutMs, defaultAgent.timeoutMs),
    maxAttempts: normalizeAttempts(data.maxAttempts, defaultAgent.maxAttempts),
    fallbacks: normalizeFallbacks(data.fallbacks)
  };
}

export async function callGeminiMealAnalysis(
  request: AnalyzeMealRequest,
  apiKeys: AiProviderApiKeys,
  agent: AiAgentConfig
): Promise<MealAnalysisResult> {
  const prompt = buildMealPrompt(request);
  const parts: Array<Record<string, unknown>> = [{ text: prompt }];

  if (request.imageBase64) {
    parts.push({
      inline_data: {
        mime_type: request.mimeType || "image/jpeg",
        data: request.imageBase64
      }
    });
  }

  const text = await callGeminiWithFallback({
    apiKeys,
    agent,
    parts,
    anthropicPrompt: prompt,
    anthropicImage: request.imageBase64
      ? { base64: request.imageBase64, mimeType: request.mimeType || "image/jpeg" }
      : undefined,
    generationConfig: {
      temperature: agent.temperature,
      response_mime_type: "application/json"
    },
    errorPrefix: "Gemini meal analysis",
    jsonFailureError: request.inputType === "image"
      ? () => new MealImageUnclearError()
      : undefined
  });

  const parsed = parseJsonOutput<unknown>(text);
  if (!isMealAnalysisResult(parsed)) {
    if (request.inputType === "image") {
      throw new MealImageUnclearError("The image analysis did not contain a usable food estimate");
    }
    throw new Error("Meal analysis returned an invalid result structure");
  }
  if (request.inputType === "image" && parsed.analysis_status === "unclear_image") {
    throw new MealImageUnclearError();
  }
  return parsed;
}

export async function callGeminiLeftoverAnalysis(
  input: {
    imageBase64: string;
    mimeType: string;
    latestMealName: string;
  },
  apiKeys: AiProviderApiKeys,
  agent: AiAgentConfig
): Promise<MealAnalysisResult> {
  const prompt = buildLeftoverPrompt(input.latestMealName);
  const text = await callGeminiWithFallback({
    apiKeys,
    agent,
    parts: [
      { text: prompt },
      { inline_data: { mime_type: input.mimeType || "image/jpeg", data: input.imageBase64 } }
    ],
    anthropicPrompt: prompt,
    anthropicImage: { base64: input.imageBase64, mimeType: input.mimeType || "image/jpeg" },
    generationConfig: {
      temperature: Math.min(agent.temperature, 0.2),
      response_mime_type: "application/json"
    },
    errorPrefix: "Gemini leftover analysis"
  });

  return parseJsonOutput(text);
}

export async function callGeminiImageClassification(
  imageBase64: string,
  mimeType: string,
  apiKeys: AiProviderApiKeys,
  agent: AiAgentConfig,
  latestMealName = ""
): Promise<ImageClassificationResult> {
  const prompt = buildImageClassificationPrompt(latestMealName);
  const text = await callGeminiWithFallback({
    apiKeys,
    agent,
    parts: [
      { text: prompt },
      { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
    ],
    anthropicPrompt: prompt,
    anthropicImage: { base64: imageBase64, mimeType: mimeType || "image/jpeg" },
    generationConfig: {
      temperature: 0,
      response_mime_type: "application/json"
    },
    errorPrefix: "Gemini image classification"
  });

  const parsed = parseJsonOutput<ImageClassificationResult>(text);
  return {
    ...parsed,
    type: normalizeImageType(parsed.type)
  };
}

export async function callGeminiBiaAnalysis(
  input: {
    base64: string;
    mimeType: string;
    displayName: string;
    currentTargetCal: number;
  },
  apiKeys: AiProviderApiKeys,
  agent: AiAgentConfig
): Promise<BiaAnalysisResult> {
  const prompt = buildBiaPrompt(input.displayName, input.currentTargetCal);
  const text = await callGeminiWithFallback({
    apiKeys,
    agent,
    parts: [
      { text: prompt },
      { inline_data: { mime_type: input.mimeType || "image/jpeg", data: input.base64 } }
    ],
    anthropicPrompt: prompt,
    anthropicImage: { base64: input.base64, mimeType: input.mimeType || "image/jpeg" },
    generationConfig: {
      temperature: 0.1,
      response_mime_type: "application/json"
    },
    errorPrefix: "Gemini BIA analysis"
  });

  return parseJsonOutput(text);
}

export async function callGeminiCoachConsultation(
  request: CoachConsultationRequest,
  apiKeys: AiProviderApiKeys,
  agent: AiAgentConfig
): Promise<string> {
  const prompt = buildCoachConsultationPrompt(request);
  const text = await callGeminiWithFallback({
    apiKeys,
    agent,
    parts: [{ text: prompt }],
    anthropicPrompt: prompt,
    generationConfig: {
      temperature: agent.temperature,
      maxOutputTokens: COACH_MAX_OUTPUT_TOKENS
    },
    errorPrefix: "Gemini coach consultation"
  });

  return text.trim();
}

export async function callGeminiExerciseAnalysis(
  request: AnalyzeExerciseRequest,
  apiKeys: AiProviderApiKeys,
  agent: AiAgentConfig
): Promise<ExerciseAnalysisResult> {
  try {
    const prompt = buildExercisePrompt(request);
    const text = await callGeminiWithFallback({
      apiKeys,
      agent,
      parts: [{ text: prompt }],
      anthropicPrompt: prompt,
      generationConfig: {
        temperature: agent.temperature,
        response_mime_type: "application/json"
      },
      errorPrefix: "Gemini exercise analysis"
    });

    return parseJsonOutput(text);
  } catch (error) {
    console.warn("Falling back to rule-based exercise estimate", error);
    return buildFallbackExerciseAnalysis(request);
  }
}

function getDefaultAgent(agentId: string): AiAgentConfig {
  return {
    agentId,
    ...DEFAULT_AGENT_BASE,
    promptVersion: DEFAULT_AGENT_PROMPT_VERSION[agentId] ?? `${agentId}-v1`
  };
}

function normalizeAiProvider(provider: unknown): AiAgentConfig["provider"] {
  if (provider === "anthropic" || provider === "openai") return provider;
  return "gemini";
}

function normalizeFallbacks(fallbacks: unknown): AiAgentFallbackConfig[] {
  if (!Array.isArray(fallbacks)) return [];
  const normalized: AiAgentFallbackConfig[] = [];
  for (const fallback of fallbacks) {
    if (!fallback || typeof fallback !== "object") continue;
    const data = fallback as Record<string, unknown>;
    const model = String(data.model ?? "").trim();
    if (!model) continue;
    normalized.push({
      provider: normalizeAiProvider(data.provider),
      model,
      temperature: normalizeOptionalNumber(data.temperature),
      timeoutMs: normalizeOptionalNumber(data.timeoutMs),
      maxAttempts: normalizeOptionalAttempts(data.maxAttempts)
    });
  }
  return normalized;
}

function normalizePositiveNumber(value: unknown, fallback: number | undefined): number | undefined {
  const normalized = normalizeOptionalNumber(value);
  return normalized ?? fallback;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

function normalizeAttempts(value: unknown, fallback: number | undefined): number | undefined {
  return normalizeOptionalAttempts(value) ?? fallback;
}

function normalizeOptionalAttempts(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 1) return undefined;
  return Math.min(Math.floor(numeric), 4);
}

function expandGeminiCandidates(agent: AiAgentConfig): AiAgentConfig[] {
  const candidates: AiAgentConfig[] = [agent];
  for (const fallback of agent.fallbacks ?? []) {
    candidates.push({
      ...agent,
      provider: fallback.provider,
      model: fallback.model,
      temperature: fallback.temperature ?? agent.temperature,
      timeoutMs: fallback.timeoutMs ?? agent.timeoutMs,
      maxAttempts: fallback.maxAttempts ?? agent.maxAttempts,
      fallbacks: []
    });
  }
  return candidates;
}

async function callGeminiWithFallback(input: {
  apiKeys: AiProviderApiKeys;
  agent: AiAgentConfig;
  parts: GeminiPart[];
  anthropicPrompt: string;
  anthropicImage?: { base64: string; mimeType: string };
  generationConfig: GeminiGenerationConfig;
  errorPrefix: string;
  jsonFailureError?: () => Error;
}): Promise<string> {
  const errors: string[] = [];
  let jsonParseFailureCount = 0;
  for (const candidate of expandGeminiCandidates(input.agent)) {
    try {
      let text: string;
      if (candidate.provider === "anthropic") {
        text = await callAnthropicWithRetry({
          apiKey: requireProviderKey(input.apiKeys.anthropic, "ANTHROPIC_API_KEY"),
          agent: candidate,
          prompt: input.anthropicPrompt,
          image: input.anthropicImage,
          wantsJson: input.generationConfig.response_mime_type === "application/json",
          maxOutputTokens: input.generationConfig.maxOutputTokens,
          errorPrefix: input.errorPrefix
        });
      } else if (candidate.provider === "gemini") {
        text = await callGeminiWithRetry({
          apiKey: requireProviderKey(input.apiKeys.gemini, "GEMINI_API_KEY"),
          agent: candidate,
          parts: input.parts,
          generationConfig: {
            ...input.generationConfig,
            temperature: input.generationConfig.temperature ?? candidate.temperature
          },
          errorPrefix: input.errorPrefix
        });
      } else {
        throw new Error(`Provider adapter is not implemented: ${candidate.provider}`);
      }
      if (input.generationConfig.response_mime_type === "application/json") {
        // A 200 response that isn't valid JSON (e.g. the model replying
        // "I don't see any food") must count as a failure so the next candidate
        // (fallback provider) is tried instead of throwing to the caller.
        parseJsonOutput(text);
      }
      if (candidate.provider !== input.agent.provider || candidate.model !== input.agent.model) {
        console.warn(`${input.errorPrefix} recovered with fallback ${candidate.provider}/${candidate.model}`);
      }
      input.agent.provider = candidate.provider;
      input.agent.model = candidate.model;
      input.agent.temperature = candidate.temperature;
      return text;
    } catch (error) {
      if (error instanceof SyntaxError) jsonParseFailureCount += 1;
      errors.push(`${candidate.provider}/${candidate.model}: ${error instanceof Error ? error.message : String(error)}`);
      console.warn(`${input.errorPrefix} candidate failed`, {
        provider: candidate.provider,
        model: candidate.model,
        error
      });
    }
  }

  if (input.jsonFailureError && errors.length > 0 && jsonParseFailureCount === errors.length) {
    throw input.jsonFailureError();
  }
  throw new Error(`${input.errorPrefix} failed for all candidates: ${errors.join(" | ")}`);
}

async function callGeminiWithRetry(input: {
  apiKey: string;
  agent: AiAgentConfig;
  parts: GeminiPart[];
  generationConfig: GeminiGenerationConfig;
  errorPrefix: string;
}): Promise<string> {
  const maxAttempts = input.agent.maxAttempts ?? 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callGeminiOnce(input);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientGeminiError(error)) break;
      await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function callAnthropicWithRetry(input: {
  apiKey: string;
  agent: AiAgentConfig;
  prompt: string;
  image?: { base64: string; mimeType: string };
  wantsJson: boolean;
  maxOutputTokens?: number;
  errorPrefix: string;
}): Promise<string> {
  const maxAttempts = input.agent.maxAttempts ?? 2;
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await callAnthropicOnce(input);
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientProviderError(error)) break;
      await delay(250 * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function callAnthropicOnce(input: {
  apiKey: string;
  agent: AiAgentConfig;
  prompt: string;
  image?: { base64: string; mimeType: string };
  wantsJson: boolean;
  maxOutputTokens?: number;
  errorPrefix: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.agent.timeoutMs ?? 20_000);
  const content: Array<Record<string, unknown>> = [];
  if (input.image) {
    // Anthropic's image block only accepts jpeg/png/gif/webp. PDFs (e.g. BIA
    // reports) must be sent as a document block instead, or the API returns 400.
    const isPdf = input.image.mimeType === "application/pdf";
    content.push(isPdf
      ? {
          type: "document",
          source: {
            type: "base64",
            media_type: "application/pdf",
            data: input.image.base64
          }
        }
      : {
          type: "image",
          source: {
            type: "base64",
            media_type: input.image.mimeType,
            data: input.image.base64
          }
        });
  }
  content.push({
    type: "text",
    text: input.wantsJson ? `${input.prompt}\n\nReturn only valid JSON. Do not wrap it in markdown.` : input.prompt
  });

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": input.apiKey,
        "anthropic-version": "2023-06-01"
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: input.agent.model,
        max_tokens: input.maxOutputTokens ?? (input.wantsJson ? 2048 : 1024),
        temperature: input.agent.temperature,
        messages: [{ role: "user", content }]
      })
    });

    if (!res.ok) {
      const text = await res.text();
      throw new ProviderHttpError(`${input.errorPrefix} Anthropic failed: ${res.status} ${text}`, res.status);
    }

    const json = await res.json() as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = json.content?.find((part) => part.type === "text" && part.text)?.text;
    if (!text) throw new Error(`${input.errorPrefix} Anthropic returned no text output`);
    return text.trim();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${input.errorPrefix} Anthropic timed out after ${input.agent.timeoutMs ?? 20_000}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callGeminiOnce(input: {
  apiKey: string;
  agent: AiAgentConfig;
  parts: GeminiPart[];
  generationConfig: GeminiGenerationConfig;
  errorPrefix: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.agent.timeoutMs ?? 20_000);

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${input.agent.model}:generateContent?key=${input.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: input.parts }],
          generationConfig: input.generationConfig
        })
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new GeminiHttpError(`${input.errorPrefix} failed: ${res.status} ${text}`, res.status);
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error(`${input.errorPrefix} returned no text output`);

    return text;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${input.errorPrefix} timed out after ${input.agent.timeoutMs ?? 20_000}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

class GeminiHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "GeminiHttpError";
  }
}

class ProviderHttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ProviderHttpError";
  }
}

function isTransientGeminiError(error: unknown): boolean {
  return isTransientProviderError(error);
}

function isTransientProviderError(error: unknown): boolean {
  if (error instanceof GeminiHttpError) {
    return error.status === 408 || error.status === 429 || error.status >= 500;
  }
  if (error instanceof ProviderHttpError) {
    return error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(message);
}

function requireProviderKey(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildMealPrompt(request: AnalyzeMealRequest): string {
  const inputHint = request.inputType === "image"
    ? `STEP 1 — Inventory: scan the WHOLE image and list every distinct edible item, in EVERY container (the main bowl/plate AND any side dish, bag, or packet beside it). When more than one protein is present (e.g. fish AND pork ribs in the same bowl), keep them as SEPARATE items — do not collapse different-looking pieces into one ingredient, and do not assume the only protein is the one in the dish name.
STEP 2 — Identify the SPECIFIC main dish from its distinctive visual cues — broth/sauce COLOR, toppings, garnishes, noodle/rice type, and cooking style.
- Name the exact dish, e.g. "เย็นตาโฟผัดแห้ง" (recognisable by its pink fermented-tofu sauce), not the generic "ก๋วยเตี๋ยวแห้ง". If several items are present, name the main dish but list the extra proteins/sides in "portion_description".
- Distinguish look-alikes by colour/sauce/topping: ผัดซีอิ๊ว vs ราดหน้า vs ผัดไทย, ข้าวมันไก่ vs ข้าวหมูแดง, ต้มยำ vs ต้มข่า.
- Count the portion of ALL edible items ACTUALLY visible across every container (the visible amount; if it is half-eaten, count what remains). NEVER ignore a visible protein or side item just because it is not part of the dish name. If a nutrition label is visible, use its exact values.`
    : `Analyze this food the user described in Thai: "${request.text ?? ""}".
- Estimate nutrients for the described portion. Words like "นิดเดียว", "น้อย", "ครึ่ง" mean a smaller portion (reduce calories accordingly).`;

  const correctionHint = request.userCorrection
    ? `\n\nUSER CORRECTION — the person who ate this reviewed a previous analysis and says: "${request.userCorrection}". Treat this as authoritative first-hand information. Fix the dish name, the condiments/toppings (e.g. a drizzle they say is honey or olive oil and NOT sugar/syrup, or vice versa), AND the macros to match what they say. Where their note conflicts with your visual guess, THEY are right.`
    : "";

  return `Act as an expert nutritionist specialized in global cuisines (Thai, Chinese, Japanese, Korean, Western, etc.) as commonly served in Thailand. You can recognise specific named dishes, not just generic food categories.

${inputHint}${correctionHint}

Image quality gate:
- For image input, first decide whether enough edible food and portion detail is visible for a credible nutrition estimate.
- If the image is too blurry, dark, obstructed, tightly cropped, shows only closed packaging, is not actually food, or otherwise cannot support a credible estimate, set "analysis_status" to "unclear_image", use neutral names, and return zeros. Do NOT guess.
- Otherwise set "analysis_status" to "ok".
- For text input, always set "analysis_status" to "ok".

Analysis priority:
1. Inventory every edible item across all containers, then identify the specific main dish (as described above).
2. The nutrient totals MUST be the SUM of ALL items you inventoried — every protein, side, and the contents of any separate bag/packet — not just the main dish.
3. Hidden calories: INCLUDE the oil, sugar, coconut milk, and sauce absorbed INTO the food even if not separately visible — Thai food hides calories here. A dipping sauce (น้ำจิ้ม) is small in volume but can be high in sugar and sodium.
4. Do NOT over-assume a visible drizzle/dressing/topping: balsamic glaze, syrup, honey, soy, and oil look alike in a photo. When it is ambiguous, do not default to "sugar" or a large oil load — pick the most neutral plausible option, keep its macro and health-score impact modest, and describe it tentatively in "portion_description" (e.g. "ราดซอสเข้ม อาจเป็นบัลซามิก/น้ำเชื่อม") instead of stating a specific sweetener or oil as fact.
5. You MUST estimate "fiber_g" as a realistic number (e.g. 0.5, 3.2), not 0 by default.

Health score (1-10):
- 1-3: deep-fried, high sugar, heavy oil/grease.
- 4-6: moderate / balanced.
- 7-10: high protein, whole foods, low oil and sugar.

Language: "dish_name.th", "portion_description", and "health_rating.comment" MUST be in Thai only. Keep "comment" a short, practical coaching note. In "portion_description", give a useful 2–3 sentence assessment: state the estimated serving size and the visible main components, include separate sides/proteins and sauces when present, and name any material uncertainty or assumption. This is shown directly to the user, so do not make it overly terse.

Return JSON only with this exact shape:
{
  "analysis_status": "ok" | "unclear_image",
  "dish_name": { "th": "Thai dish name", "en": "English dish name" },
  "portion_description": "Detailed Thai assessment of portion, visible components, sides/sauces, and key uncertainty",
  "nutrients": {
    "calories_kcal": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "fiber_g": 0,
    "sugar_g": 0
  },
  "health_rating": {
    "score": 1,
    "comment": "Thai coaching comment"
  }
}

Use numbers (not strings) for all nutrients. health_rating.score must be an integer 1-10.`;
}

function buildLeftoverPrompt(latestMealName: string): string {
  return `Act as an expert Thai nutrition coach.
The user's latest logged meal is "${latestMealName}".
Analyze this image as leftovers/residue from that latest meal.

Return JSON only with this exact shape:
{
  "dish_name": { "th": "Thai name of visible leftover", "en": "English name of visible leftover" },
  "portion_description": "Short Thai description of the leftover amount to subtract",
  "nutrients": {
    "calories_kcal": 0,
    "protein_g": 0,
    "carbs_g": 0,
    "fat_g": 0,
    "fiber_g": 0,
    "sugar_g": 0
  },
  "health_rating": {
    "score": 5,
    "comment": "Thai note explaining this is the estimated leftover amount being subtracted"
  }
}

Rules:
- Estimate ONLY the visible uneaten food/waste/residue that should be subtracted from the latest meal.
- Do not estimate the whole original meal.
- If the image mainly shows empty plate, bones, wrappers, soup residue, sauce, rice left, or uneaten food scraps, estimate conservatively.
- If no meaningful leftover nutrients are visible, return zeros.
- Use Thai language for text fields.
- Use numbers, not strings, for nutrients.`;
}

function buildImageClassificationPrompt(latestMealName = ""): string {
  const leftoverContext = latestMealName
    ? `\n\nContext: the user's most recent logged meal was "${latestMealName}". Classify as "leftover" only when this image shows a partially-eaten, reduced, or scrap version of THAT SAME meal (same food type, smaller portion or remains). If it is a different food type or a full/new portion, classify as "food".`
    : "";
  return `Classify this LINE image for a Thai diet coach/payment bot.

Return JSON only with this exact shape:
{
  "type": "food" | "unclear_food" | "slip" | "bia" | "leftover" | "other",
  "confidence": 0.0,
  "slip_data": {
    "amount": 0,
    "date": "string",
    "time": "string",
    "receiver_name": "string",
    "bank_from": "string",
    "bank_to": "string"
  }
}

Rules:
- "slip" means bank transfer slip, payment confirmation, QR payment receipt, or mobile banking transfer screenshot.
- "bia" means InBody/body composition/smart scale/medical report/table of health metrics.
- "leftover" means a mostly eaten meal, empty/near-empty plate, bones, sauce/soup residue, wrappers, or scraps intended to subtract from the latest food log.
- "food" means food, drink, snack, menu, or nutrition label with enough visible detail to support a credible nutrition estimate.
- "unclear_food" means the image probably contains food, but it is too blurry, dark, obstructed, tightly cropped, hidden inside closed packaging, or otherwise lacks enough visible detail for a credible estimate. Use this instead of guessing "food".
- "other" means anything else.
- If not a payment slip, omit slip_data or set fields empty.
- Use numeric amount only when visible.${leftoverContext}`;
}

function buildBiaPrompt(displayName: string, currentTargetCal: number): string {
  return `Act as an expert personal trainer and Thai nutrition coach.
Analyze this BIA/InBody/smart-scale/health report for user "${displayName}".
Current target TDEE is ${currentTargetCal} kcal.

Tasks:
1. Extract report date (DD/MM/YYYY or TODAY) and device brand/model if visible.
2. Extract metrics: weight, skeletal muscle/muscle mass, body fat percentage, the MEASURED BMR shown on the report, and visceral fat level.
3. Calculate a new plan FROM THE MEASURED BMR on the report (use the report's BMR, not a formula estimate):
   - Estimate maintenance TDEE from the measured BMR and the user's typical activity.
   - Choose the goal by body-fat status: higher body fat -> a calorie deficit (cut); lean with low muscle -> a slight surplus (bulk); otherwise maintain. Keep changes conservative and safe.
   - Suggest protein/carb/fat in grams that fit that target.
4. Give Thai reasoning (reason_th) and workout advice targeting the weak points you found.

Return JSON only with this exact shape:
{
  "meta": { "date_str": "DD/MM/YYYY or TODAY", "device_name": "string" },
  "metrics": {
    "weight_kg": 0,
    "muscle_kg": 0,
    "fat_pct": 0,
    "bmr": 0,
    "visceral_lvl": 0
  },
  "recommendation": {
    "suggested_tdee": 0,
    "suggested_p": 0,
    "suggested_c": 0,
    "suggested_f": 0,
    "goal_name": "string",
    "reason_th": "Thai explanation"
  },
  "workout_advice_th": "Thai workout advice"
}

Rules:
- Use numbers, not strings, for metrics and macros.
- If a value is not visible, use 0.
- Recommendations must be conservative and safe.
- Do not diagnose disease or make medical claims.`;
}

function buildCoachConsultationPrompt(request: CoachConsultationRequest): string {
  const modeInstruction = request.mode === "menu_recommendation"
    ? "Recommend 3 practical Thai meal options that fit the user's remaining calories/macros today."
    : "Answer the user's nutrition or exercise question as a practical Thai AI coach.";

  return `Act as a Thai dietitian-style AI coach. ${modeInstruction}

User question:
"${request.text}"

User profile:
- Name: ${request.profileName}
- Target: ${request.target.calories} kcal, protein ${request.target.proteinG} g, carbs ${request.target.carbsG} g, fat ${request.target.fatG} g, fiber ${request.target.fiberG} g

Today's summary:
- Consumed: ${request.today.consumedCalories} kcal, protein ${request.today.consumedProteinG} g, carbs ${request.today.consumedCarbsG} g, fat ${request.today.consumedFatG} g, fiber ${request.today.consumedFiberG} g
- Exercise burned: ${request.today.burnedCalories} kcal
- Dynamic calorie target after exercise: ${request.today.dynamicTargetCalories} kcal
- Remaining: ${request.today.remainingCalories} kcal, protein ${request.today.remainingProteinG} g, carbs ${request.today.remainingCarbsG} g, fat ${request.today.remainingFatG} g, fiber ${request.today.remainingFiberG} g

Recent meals:
${request.recentMeals.length ? request.recentMeals.map((meal) => `- ${meal}`).join("\n") : "- No recent meals found"}

Rules:
- Reply in Thai only.
- Be concise, warm, and actionable.
- If recommending menus, include approximate calories and protein for each option.
- Do not log food, change targets, or claim that any data was saved.
- Avoid medical diagnosis. If the user asks about disease, medication, pregnancy, eating disorder, or severe symptoms, recommend professional care.
- If today's remaining calories are low or negative, recommend lighter options or planning the next meal/day safely.`;
}

function normalizeImageType(type: unknown): ImageClassificationResult["type"] {
  if (type === "unclear_food" || type === "unclear-food" || type === "unclear") return "unclear_food";
  return type === "slip" || type === "bia" || type === "leftover" || type === "other" ? type : "food";
}

function isMealAnalysisResult(value: unknown): value is MealAnalysisResult {
  if (!value || typeof value !== "object") return false;
  const result = value as Partial<MealAnalysisResult>;
  return Boolean(
    result.dish_name &&
    typeof result.dish_name.th === "string" &&
    typeof result.dish_name.en === "string" &&
    typeof result.portion_description === "string" &&
    result.nutrients &&
    typeof result.nutrients.calories_kcal === "number" &&
    typeof result.nutrients.protein_g === "number" &&
    typeof result.nutrients.carbs_g === "number" &&
    typeof result.nutrients.fat_g === "number" &&
    result.health_rating &&
    typeof result.health_rating.score === "number" &&
    typeof result.health_rating.comment === "string"
  );
}

function buildExercisePrompt(request: AnalyzeExerciseRequest): string {
  return `Act as a practical fitness coach. Estimate calories burned for this exercise text: "${request.text}".

Assumptions:
- If body weight is not given, assume 60 kg.
- If duration is not clear, infer a conservative reasonable duration from the text.
- Return raw total calories burned before any safety factor.
- Thai activity names and Thai comments are preferred.

Return JSON only with this exact shape:
{
  "activity_name": "Thai activity name",
  "calories_burned": 0,
  "comment": "Thai coaching comment"
}`;
}

function buildFallbackExerciseAnalysis(request: AnalyzeExerciseRequest): ExerciseAnalysisResult {
  const lower = request.text.toLowerCase();
  const minutes = extractExerciseMinutes(lower);
  const met = estimateExerciseMet(lower);
  const assumedWeightKg = 60;
  const calories = Math.max(20, Math.round((met * 3.5 * assumedWeightKg / 200) * minutes));
  return {
    activity_name: estimateExerciseName(lower),
    calories_burned: calories,
    comment: "ประเมินแบบ conservative จาก rule-based fallback เพราะ AI exercise analysis ตอบไม่สำเร็จชั่วคราว"
  };
}

function extractExerciseMinutes(lowerText: string): number {
  const minuteMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:นาที|min|mins|minute|minutes)/i);
  if (minuteMatch) return Number(minuteMatch[1]);

  const hourMatch = lowerText.match(/(\d+(?:\.\d+)?)\s*(?:ชม|ชั่วโมง|hr|hrs|hour|hours)/i);
  if (hourMatch) return Number(hourMatch[1]) * 60;

  return 30;
}

function estimateExerciseMet(lowerText: string): number {
  if (/วิ่ง|run|running/.test(lowerText)) return 8;
  if (/เดิน|walk|walking/.test(lowerText)) return 3.5;
  if (/ปั่น|จักรยาน|bike|cycling/.test(lowerText)) return 6;
  if (/ว่าย|swim|swimming/.test(lowerText)) return 7;
  if (/เวท|weight|workout|ยกน้ำหนัก/.test(lowerText)) return 4.5;
  if (/hiit|cardio/.test(lowerText)) return 7;
  if (/โยคะ|yoga|pilates/.test(lowerText)) return 3;
  return 4;
}

function estimateExerciseName(lowerText: string): string {
  if (/วิ่ง|run|running/.test(lowerText)) return "วิ่ง";
  if (/เดิน|walk|walking/.test(lowerText)) return "เดิน";
  if (/ปั่น|จักรยาน|bike|cycling/.test(lowerText)) return "ปั่นจักรยาน";
  if (/ว่าย|swim|swimming/.test(lowerText)) return "ว่ายน้ำ";
  if (/เวท|weight|workout|ยกน้ำหนัก/.test(lowerText)) return "เวทเทรนนิ่ง";
  if (/โยคะ|yoga/.test(lowerText)) return "โยคะ";
  if (/pilates/.test(lowerText)) return "พิลาทิส";
  return "ออกกำลังกาย";
}

function parseJsonOutput<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as T;
}
