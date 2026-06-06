import type {
  AiAgentConfig,
  AnalyzeExerciseRequest,
  AnalyzeMealRequest,
  ExerciseAnalysisResult,
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
  exerciseAnalysis: "exercise-v1"
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

export async function callGeminiExerciseAnalysis(
  request: AnalyzeExerciseRequest,
  apiKey: string,
  agent: AiAgentConfig
): Promise<ExerciseAnalysisResult> {
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

function parseJsonOutput<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as T;
}
