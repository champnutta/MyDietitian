import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { defineSecret } from "firebase-functions/params";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AnalyzeMealRequest,
  DashboardDataRequest,
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

export const getDashboardData = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as DashboardDataRequest;
  if (!body?.userId) {
    response.status(400).json({ ok: false, error: "missing-user-id" });
    return;
  }

  const { startDate, endDate } = resolveDashboardRange(body);
  const history = buildDailyHistory(startDate, endDate);
  const profileSnap = await db.collection("profiles").doc(body.userId).get();
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const target = normalizeTarget(profile);

  await fillMealHistory(body.userId, startDate, endDate, history);
  await fillExerciseHistory(body.userId, startDate, endDate, history);
  await fillWeightHistory(body.userId, startDate, endDate, history);

  const labels = Object.keys(history);
  const calories = labels.map((key) => history[key].cal);
  const weights = labels.map((key) => history[key].weight);
  const fats = labels.map((key) => history[key].fat);
  const muscles = labels.map((key) => history[key].muscle);
  const devices = labels.map((key) => history[key].device);
  const macros = {
    p: labels.map((key) => history[key].p),
    c: labels.map((key) => history[key].c),
    f: labels.map((key) => history[key].f),
    fib: labels.map((key) => history[key].fib)
  };

  const tdeeLine = labels.map((key) => target.cal + history[key].burn);
  const totalCal = calories.reduce((sum, value) => sum + value, 0);
  const activeDays = calories.filter((value) => value > 0).length || 1;
  const successDays = labels.filter((key) => {
    const intake = history[key].cal;
    const limit = target.cal + history[key].burn + 100;
    return intake > 0 && intake <= limit;
  }).length;

  let currentWeight = 0;
  for (let index = weights.length - 1; index >= 0; index -= 1) {
    if (weights[index] !== null) {
      currentWeight = weights[index] ?? 0;
      break;
    }
  }

  response.json({
    ok: true,
    profile: {
      name: profile.displayName ?? "Member",
      target
    },
    current: { weight: currentWeight },
    labels,
    calories,
    bodyData: { weight: weights, fat: fats, muscle: muscles, devices },
    tdeeLine,
    macros,
    stats: {
      avgCal: totalCal / activeDays,
      totalDays: activeDays,
      successDays
    }
  });
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

type DailyHistory = Record<string, {
  cal: number;
  p: number;
  c: number;
  f: number;
  fib: number;
  burn: number;
  weight: number | null;
  fat: number | null;
  muscle: number | null;
  device: string | null;
}>;

function resolveDashboardRange(request: DashboardDataRequest): { startDate: Date; endDate: Date } {
  const now = new Date();
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  let startDate: Date;
  let endDate: Date;

  if (request.option === "custom" && request.customStartStr && request.customEndStr) {
    startDate = new Date(request.customStartStr);
    endDate = new Date(request.customEndStr);
  } else {
    const days = typeof request.option === "number" ? request.option : 7;
    endDate = new Date(today);
    startDate = new Date(today);
    startDate.setDate(today.getDate() - days + 1);
  }

  startDate.setHours(0, 0, 0, 0);
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
}

function buildDailyHistory(startDate: Date, endDate: Date): DailyHistory {
  const history: DailyHistory = {};
  const cursor = new Date(startDate);

  while (cursor <= endDate) {
    history[formatDayKey(cursor)] = {
      cal: 0,
      p: 0,
      c: 0,
      f: 0,
      fib: 0,
      burn: 0,
      weight: null,
      fat: null,
      muscle: null,
      device: null
    };
    cursor.setDate(cursor.getDate() + 1);
  }

  return history;
}

async function fillMealHistory(userId: string, startDate: Date, endDate: Date, history: DailyHistory) {
  const snap = await db.collection("mealLogs")
    .where("userId", "==", userId)
    .where("loggedAt", ">=", Timestamp.fromDate(startDate))
    .where("loggedAt", "<=", Timestamp.fromDate(endDate))
    .orderBy("loggedAt", "asc")
    .get();

  snap.forEach((doc) => {
    const data = doc.data();
    const key = timestampDayKey(data.loggedAt);
    if (!key || !history[key]) return;
    const nutrients = data.nutrients ?? {};
    history[key].cal += Number(nutrients.caloriesKcal ?? 0);
    history[key].p += Number(nutrients.proteinG ?? 0);
    history[key].c += Number(nutrients.carbsG ?? 0);
    history[key].f += Number(nutrients.fatG ?? 0);
    history[key].fib += Number(nutrients.fiberG ?? 0);
  });
}

async function fillExerciseHistory(userId: string, startDate: Date, endDate: Date, history: DailyHistory) {
  const snap = await db.collection("exerciseLogs")
    .where("userId", "==", userId)
    .where("loggedAt", ">=", Timestamp.fromDate(startDate))
    .where("loggedAt", "<=", Timestamp.fromDate(endDate))
    .orderBy("loggedAt", "asc")
    .get();

  snap.forEach((doc) => {
    const data = doc.data();
    const key = timestampDayKey(data.loggedAt);
    if (!key || !history[key]) return;
    history[key].burn += Number(data.caloriesBurned ?? 0);
  });
}

async function fillWeightHistory(userId: string, startDate: Date, endDate: Date, history: DailyHistory) {
  const snap = await db.collection("weightLogs")
    .where("userId", "==", userId)
    .where("loggedAt", ">=", Timestamp.fromDate(startDate))
    .where("loggedAt", "<=", Timestamp.fromDate(endDate))
    .orderBy("loggedAt", "asc")
    .get();

  snap.forEach((doc) => {
    const data = doc.data();
    const key = timestampDayKey(data.loggedAt);
    if (!key || !history[key]) return;
    history[key].weight = Number(data.weightKg ?? 0) || null;
    history[key].fat = Number(data.bodyFatPct ?? 0) || null;
    history[key].muscle = Number(data.muscleMassKg ?? 0) || null;
    history[key].device = data.deviceName ?? "Legacy Sheet";
  });
}

function normalizeTarget(profile: Record<string, unknown>) {
  const target = (profile.target ?? {}) as Record<string, unknown>;
  return {
    cal: Number(target.calories ?? target.cal ?? 0),
    p: Number(target.proteinG ?? target.p ?? 0),
    c: Number(target.carbsG ?? target.c ?? 0),
    f: Number(target.fatG ?? target.f ?? 0),
    fib: Number(target.fiberG ?? target.fib ?? 25)
  };
}

function timestampDayKey(value: unknown): string | null {
  if (value instanceof Timestamp) {
    return formatDayKey(value.toDate());
  }
  if (value instanceof Date) {
    return formatDayKey(value);
  }
  return null;
}

function formatDayKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}
