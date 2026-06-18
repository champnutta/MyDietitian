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
  model: "gemini-3-flash-preview",
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
};

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
    generationConfig: {
      temperature: agent.temperature,
      response_mime_type: "application/json"
    },
    errorPrefix: "Gemini meal analysis"
  });

  return parseJsonOutput(text);
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
  agent: AiAgentConfig
): Promise<ImageClassificationResult> {
  const prompt = buildImageClassificationPrompt();
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
      temperature: agent.temperature
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
}): Promise<string> {
  const errors: string[] = [];
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
      if (candidate.provider !== input.agent.provider || candidate.model !== input.agent.model) {
        console.warn(`${input.errorPrefix} recovered with fallback ${candidate.provider}/${candidate.model}`);
      }
      input.agent.provider = candidate.provider;
      input.agent.model = candidate.model;
      input.agent.temperature = candidate.temperature;
      return text;
    } catch (error) {
      errors.push(`${candidate.provider}/${candidate.model}: ${error instanceof Error ? error.message : String(error)}`);
      console.warn(`${input.errorPrefix} candidate failed`, {
        provider: candidate.provider,
        model: candidate.model,
        error
      });
    }
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
  errorPrefix: string;
}): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.agent.timeoutMs ?? 20_000);
  const content: Array<Record<string, unknown>> = [];
  if (input.image) {
    content.push({
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
        max_tokens: input.wantsJson ? 2048 : 1024,
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
    ? "Analyze the visible food image only. Do not assume hidden ingredients."
    : `Analyze this user food text: ${request.text ?? ""}`;

  return `Act as an expert Thai nutrition coach. ${inputHint}

Return JSON only with this exact shape:
{
  "dish_name": { "th": "Thai dish name", "en": "English dish name" },
  "portion_description": "Short Thai portion description",
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

Rules:
- Estimate only the food that is visible or explicitly described.
- Use Thai language for health_rating.comment.
- health_rating.score must be 1 to 10.
- Use numbers, not strings, for nutrients.`;
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

function buildImageClassificationPrompt(): string {
  return `Classify this LINE image for a Thai diet coach/payment bot.

Return JSON only with this exact shape:
{
  "type": "food" | "slip" | "bia" | "leftover" | "other",
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
- "food" means food, drink, snack, menu, or nutrition label.
- "other" means anything else.
- If not a payment slip, omit slip_data or set fields empty.
- Use numeric amount only when visible.`;
}

function buildBiaPrompt(displayName: string, currentTargetCal: number): string {
  return `Act as an expert personal trainer and Thai nutrition coach.
Analyze this BIA/InBody/smart-scale/health report for user "${displayName}".
Current target TDEE is ${currentTargetCal} kcal.

Tasks:
1. Extract report date and device name if visible.
2. Extract body metrics: weight, skeletal muscle/muscle mass, body fat percentage, BMR, visceral fat level.
3. Recommend a conservative updated nutrition target based on the report.
4. Give Thai-language reasoning and workout advice.

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
  return type === "slip" || type === "bia" || type === "leftover" || type === "other" ? type : "food";
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
