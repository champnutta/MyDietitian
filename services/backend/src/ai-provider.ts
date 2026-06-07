import type {
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
  enabled: true
} satisfies Omit<AiAgentConfig, "agentId" | "promptVersion">;

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
    enabled: data.enabled !== false
  };
}

export async function callGeminiMealAnalysis(
  request: AnalyzeMealRequest,
  apiKey: string,
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

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: agent.temperature,
          response_mime_type: "application/json"
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API failed: ${res.status} ${text}`);
  }

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no text output");

  return parseJsonOutput(text);
}

export async function callGeminiImageClassification(
  imageBase64: string,
  mimeType: string,
  apiKey: string,
  agent: AiAgentConfig
): Promise<ImageClassificationResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: buildImageClassificationPrompt() },
            { inline_data: { mime_type: mimeType || "image/jpeg", data: imageBase64 } }
          ]
        }],
        generationConfig: {
          temperature: 0,
          response_mime_type: "application/json"
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini image classification failed: ${res.status} ${text}`);
  }

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no image classification output");

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
  apiKey: string,
  agent: AiAgentConfig
): Promise<BiaAnalysisResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: buildBiaPrompt(input.displayName, input.currentTargetCal) },
            { inline_data: { mime_type: input.mimeType || "image/jpeg", data: input.base64 } }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          response_mime_type: "application/json"
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini BIA analysis failed: ${res.status} ${text}`);
  }

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no BIA analysis output");

  return parseJsonOutput(text);
}

export async function callGeminiCoachConsultation(
  request: CoachConsultationRequest,
  apiKey: string,
  agent: AiAgentConfig
): Promise<string> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: buildCoachConsultationPrompt(request) }] }],
        generationConfig: {
          temperature: agent.temperature
        }
      })
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini coach consultation failed: ${res.status} ${text}`);
  }

  const json = await res.json() as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini returned no coach consultation output");

  return text.trim();
}

export async function callGeminiExerciseAnalysis(
  request: AnalyzeExerciseRequest,
  apiKey: string,
  agent: AiAgentConfig
): Promise<ExerciseAnalysisResult> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${agent.model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildExercisePrompt(request) }] }],
          generationConfig: {
            temperature: agent.temperature,
            response_mime_type: "application/json"
          }
        })
      }
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Gemini exercise API failed: ${res.status} ${text}`);
    }

    const json = await res.json() as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error("Gemini returned no exercise text output");

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
  return provider === "anthropic" ? "anthropic" : "gemini";
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

function buildImageClassificationPrompt(): string {
  return `Classify this LINE image for a Thai diet coach/payment bot.

Return JSON only with this exact shape:
{
  "type": "food" | "slip" | "bia" | "other",
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
  return type === "slip" || type === "bia" || type === "other" ? type : "food";
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
