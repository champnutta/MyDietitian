import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AnalyzeMealRequest,
  LineWebhookEvent,
  MealAnalysisResult,
  UpdateProfileRequest
} from "./contracts.js";

initializeApp();
setGlobalOptions({ region: "asia-southeast1" });
const db = getFirestore();
const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
const ADMIN_LINE_USER_ID = defineSecret("ADMIN_LINE_USER_ID");

const GEMINI_MODEL = "gemini-3-flash-preview";
const MEAL_PROMPT_VERSION = "meal-v1";

export const health = onRequest((request, response) => {
  response.json({
    ok: true,
    service: "mydietitian-backend",
    method: request.method,
    message: "Firebase Functions scaffold is ready."
  });
});

export const updateProfile = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as { userId?: string; profile?: UpdateProfileRequest };
  if (!body?.userId || !body?.profile) {
    response.status(400).json({ ok: false, error: "missing-user-or-profile" });
    return;
  }

  const now = Timestamp.now();
  await db.collection("profiles").doc(body.userId).set(
    {
      userId: body.userId,
      ...body.profile,
      updatedAt: now,
      createdAt: now
    },
    { merge: true }
  );

  await db.collection("users").doc(body.userId).set(
    {
      userId: body.userId,
      updatedAt: now,
      createdAt: now,
      status: "active"
    },
    { merge: true }
  );

  response.json({ ok: true, userId: body.userId });
});

export const analyzeMeal = onRequest({ secrets: [GEMINI_API_KEY] }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as AnalyzeMealRequest;
  if (!body?.userId || !body?.source || !body?.inputType) {
    response.status(400).json({ ok: false, error: "invalid-request" });
    return;
  }

  const now = Timestamp.now();
  const aiRunRef = db.collection("aiRuns").doc();

  await aiRunRef.set({
    runId: aiRunRef.id,
    userId: body.userId,
    source: body.source,
    inputType: body.inputType,
    text: body.text ?? null,
    imageUrl: body.imageUrl ?? null,
    status: "running",
    createdAt: now,
    promptVersion: MEAL_PROMPT_VERSION,
    model: GEMINI_MODEL
  });

  try {
    const analysis = await callGeminiMealAnalysis(body, GEMINI_API_KEY.value());
    const mealLogRef = db.collection("mealLogs").doc();
    const savedAt = Timestamp.now();

    const mealLog = {
      userId: body.userId,
      source: body.source,
      inputType: body.inputType,
      text: body.text ?? null,
      imageUrl: body.imageUrl ?? null,
      mealNameTh: analysis.dish_name.th,
      mealNameEn: analysis.dish_name.en,
      portionDescription: analysis.portion_description,
      nutrients: {
        caloriesKcal: Number(analysis.nutrients.calories_kcal) || 0,
        proteinG: Number(analysis.nutrients.protein_g) || 0,
        carbsG: Number(analysis.nutrients.carbs_g) || 0,
        fatG: Number(analysis.nutrients.fat_g) || 0,
        fiberG: Number(analysis.nutrients.fiber_g) || 0,
        sugarG: Number(analysis.nutrients.sugar_g) || 0
      },
      healthRating: {
        score: Math.max(1, Math.min(10, Number(analysis.health_rating.score) || 5)),
        commentTh: analysis.health_rating.comment
      },
      ai: {
        runId: aiRunRef.id,
        model: GEMINI_MODEL,
        promptVersion: MEAL_PROMPT_VERSION
      },
      loggedAt: savedAt,
      createdAt: savedAt,
      updatedAt: savedAt
    };

    await mealLogRef.set(mealLog);
    await aiRunRef.set(
      {
        status: "completed",
        mealLogId: mealLogRef.id,
        completedAt: savedAt,
        output: analysis
      },
      { merge: true }
    );

    response.json({
      ok: true,
      runId: aiRunRef.id,
      mealLogId: mealLogRef.id,
      analysis: mealLog
    });
  } catch (error) {
    const failedAt = Timestamp.now();
    await aiRunRef.set(
      {
        status: "failed",
        failedAt,
        error: error instanceof Error ? error.message : String(error)
      },
      { merge: true }
    );
    response.status(500).json({
      ok: false,
      runId: aiRunRef.id,
      error: "meal-analysis-failed"
    });
  }
});

export const lineWebhook = onRequest(
  { secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID] },
  async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  if (!verifyLineSignature(request.rawBody, request.get("x-line-signature") ?? "")) {
    response.status(401).json({ ok: false, error: "invalid-line-signature" });
    return;
  }

  const payload = request.body as LineWebhookEvent;
  const now = Timestamp.now();

  await db.collection("adminAuditLogs").add({
    type: "line-webhook-staging-received",
    eventCount: payload?.events?.length ?? 0,
    payload,
    status: "received-only-no-reply",
    createdAt: now
  });

  response.json({
    ok: true,
    received: payload?.events?.length ?? 0,
    status: "staging-receiver-only",
    warning: "This endpoint verifies LINE signatures but does not reply to users yet."
  });
});

function verifyLineSignature(rawBody: Buffer, signature: string): boolean {
  if (!signature) return false;

  const digest = createHmac("sha256", LINE_CHANNEL_SECRET.value())
    .update(rawBody)
    .digest("base64");

  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

async function callGeminiMealAnalysis(
  request: AnalyzeMealRequest,
  apiKey: string
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
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          temperature: 0.2,
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

function parseJsonOutput<T>(raw: string): T {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  return JSON.parse(cleaned) as T;
}
