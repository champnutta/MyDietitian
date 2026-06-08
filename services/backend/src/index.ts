import { onRequest } from "firebase-functions/v2/https";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  callGeminiBiaAnalysis,
  callGeminiCoachConsultation,
  callGeminiExerciseAnalysis,
  callGeminiImageClassification,
  callGeminiLeftoverAnalysis,
  callGeminiMealAnalysis,
  getAiAgentConfig
} from "./ai-provider.js";
import type {
  AnalyzeExerciseRequest,
  AnalyzeMealRequest,
  CoachConsultationRequest,
  DashboardDataRequest,
  LineWebhookEvent,
  SaveSettingsFromWebRequest,
  UpdateProfileRequest
} from "./contracts.js";
import { resolveCanonicalUserId, resolveLineCanonicalUserId } from "./identity-service.js";
import {
  downloadLineContent,
  getLineProfile,
  type LineMessage,
  pushMessage,
  replyToLine,
  replyToLineMessages,
  showLoadingAnimation
} from "./line-client.js";
import {
  ADMIN_LINE_USER_ID,
  db,
  GEMINI_API_KEY,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET
} from "./runtime.js";
const LEGACY_GAS_DASHBOARD_URL =
  "https://script.google.com/macros/s/AKfycbwDDjb0vMO6kA_8GDxC51PuDzBplDh1d1dx5NPOCbY_Ho5bQvK-W0QfiNL28WUA5fpMCA/exec";
const PAYMENT_QR_IMAGE = "https://img2.pic.in.th/1613478.jpg";
const LIFF_SETTINGS_URL = "https://liff.line.me/2009365288-Ux31tFWT?page=form";
const SUBSCRIPTION_PACKAGES = [
  { days: 30, priceThb: 59 },
  { days: 90, priceThb: 150 }
] as const;

type SavedMealAnalysis = {
  runId: string;
  mealLogId: string;
  mealLog: Record<string, unknown>;
};

type SavedExerciseAnalysis = {
  runId: string;
  exerciseLogId: string;
  exerciseLog: Record<string, unknown>;
};

type SavedCoachConsultation = {
  runId: string;
  consultationId: string;
  answer: string;
  mode: CoachConsultationRequest["mode"];
};

type UserProfile = {
  name: string;
  target: {
    cal: number;
    p: number;
    c: number;
    f: number;
    fib: number;
  };
  expiresAt?: Timestamp | null;
};

type TodaySummary = {
  consumed: {
    cal: number;
    p: number;
    c: number;
    f: number;
    fib: number;
  };
  burned: number;
  target: UserProfile["target"];
  dynamicTarget: number;
  remaining: {
    cal: number;
    p: number;
    c: number;
    f: number;
    fib: number;
  };
};

type SubscriptionTarget = {
  canonicalUserId: string;
  lineUserId: string | null;
};

type AdminSubscriptionCommand =
  | { action: "approve"; target: string; days: number }
  | { action: "reject"; target: string; reason: string | null };

type UserReadiness = {
  profileComplete: boolean;
  subscriptionActive: boolean;
  expiresAt: Timestamp | null;
};

class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsValidationError";
  }
}

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
  const profileIdentityError = validateProfileIdentity(body.userId, body.profile);
  if (profileIdentityError) {
    response.status(400).json({ ok: false, error: "invalid-profile-identity", message: profileIdentityError });
    return;
  }

  const canonicalUserId = body.profile.canonicalUserId ?? body.userId;
  const now = Timestamp.now();
  await db.collection("profiles").doc(canonicalUserId).set(
    {
      userId: canonicalUserId,
      canonicalUserId,
      ...body.profile,
      updatedAt: now,
      createdAt: now
    },
    { merge: true }
  );

  await db.collection("users").doc(canonicalUserId).set(
    {
      userId: canonicalUserId,
      canonicalUserId,
      updatedAt: now,
      createdAt: now,
      status: "active",
      source: {
        app: Boolean(body.profile.firebaseAuthUid),
        line: Boolean(body.profile.lineUserId)
      }
    },
    { merge: true }
  );

  if (body.profile.lineUserId) {
    await db.collection("lineLinks").doc(body.profile.lineUserId).set(
      {
        lineUserId: body.profile.lineUserId,
        canonicalUserId,
        status: "linked",
        updatedAt: now
      },
      { merge: true }
    );
  }

  if (body.profile.firebaseAuthUid) {
    await db.collection("authLinks").doc(body.profile.firebaseAuthUid).set(
      {
        firebaseAuthUid: body.profile.firebaseAuthUid,
        canonicalUserId,
        status: "linked",
        updatedAt: now
      },
      { merge: true }
    );
  }

  response.json({ ok: true, userId: canonicalUserId, canonicalUserId });
});

export const saveSettingsFromWeb = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as SaveSettingsFromWebRequest;
  if (!body?.userId || !body?.config) {
    response.status(400).json({ ok: false, error: "missing-user-or-config" });
    return;
  }

  try {
    validateSettingsRequest(body);
    const canonicalUserId = body.canonicalUserId ??
      (body.lineUserId || body.userId.startsWith("U") ? await resolveLineCanonicalUserId(body.lineUserId ?? body.userId) : body.userId);
    const lineUserId = body.lineUserId ?? (body.userId.startsWith("U") ? body.userId : undefined);
    const target = buildTargetFromSettingsConfig(body.config);
    const now = Timestamp.now();
    const existingExpiry = await getSubscriptionExpiry(canonicalUserId);
    const expiresAt = existingExpiry ?? subscriptionExpiryAfterDays(3, null);
    const profilePayload = {
      userId: canonicalUserId,
      canonicalUserId,
      lineUserId: lineUserId ?? null,
      firebaseAuthUid: body.firebaseAuthUid ?? null,
      displayName: body.displayName ?? undefined,
      gender: normalizeSettingsGender(body.config.gender),
      age: Number(body.config.age ?? 0) || null,
      heightCm: Number(body.config.heightCm ?? body.config.height ?? 0) || null,
      weightKg: Number(body.config.weightKg ?? body.config.weight ?? 0) || null,
      activityFactor: Number(body.config.activityFactor ?? body.config.activity ?? 0) || null,
      goalType: body.config.goalType ?? inferGoalType(Number(body.config.goal ?? 0)),
      target,
      settingsSource: "web-form",
      updatedAt: now,
      createdAt: now
    };

    const writes: Array<Promise<unknown>> = [
      db.collection("profiles").doc(canonicalUserId).set(profilePayload, { merge: true }),
      db.collection("users").doc(canonicalUserId).set({
        userId: canonicalUserId,
        canonicalUserId,
        status: "active",
        source: {
          line: Boolean(lineUserId),
          app: Boolean(body.firebaseAuthUid)
        },
        updatedAt: now,
        createdAt: now
      }, { merge: true }),
      db.collection("subscriptions").doc(canonicalUserId).set({
        userId: canonicalUserId,
        canonicalUserId,
        status: expiresAt.toMillis() >= Date.now() ? "active" : "expired",
        expiresAt,
        trialGranted: existingExpiry ? false : true,
        updatedAt: now,
        createdAt: now
      }, { merge: true }),
      db.collection("profileEvents").add({
        type: "web-settings-save",
        canonicalUserId,
        lineUserId: lineUserId ?? null,
        firebaseAuthUid: body.firebaseAuthUid ?? null,
        config: sanitizeSettingsConfigForLog(body.config),
        target,
        trialGranted: !existingExpiry,
        createdAt: now
      })
    ];

    if (lineUserId) {
      writes.push(db.collection("lineLinks").doc(lineUserId).set({
        lineUserId,
        canonicalUserId,
        status: "linked",
        updatedAt: now
      }, { merge: true }));
    }
    if (body.firebaseAuthUid) {
      writes.push(db.collection("authLinks").doc(body.firebaseAuthUid).set({
        firebaseAuthUid: body.firebaseAuthUid,
        canonicalUserId,
        status: "linked",
        updatedAt: now
      }, { merge: true }));
    }
    const weightKg = Number(body.config.weightKg ?? body.config.weight ?? 0);
    if (weightKg > 0) {
      writes.push(db.collection("weightLogs").add({
        userId: canonicalUserId,
        canonicalUserId,
        source: "web-form",
        weightKg,
        bodyFatPct: null,
        muscleMassKg: null,
        deviceName: "LIFF Form",
        loggedAt: now,
        createdAt: now,
        updatedAt: now
      }));
    }

    await Promise.all(writes);

    response.json({
      ok: true,
      canonicalUserId,
      target,
      trialGranted: !existingExpiry,
      expiresAt: expiresAt.toDate().toISOString()
    });
  } catch (error) {
    const isValidationError = error instanceof SettingsValidationError;
    response.status(isValidationError ? 400 : 500).json({
      ok: false,
      error: isValidationError ? "invalid-settings" : "save-settings-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function validateProfileIdentity(userId: string, profile: UpdateProfileRequest): string | null {
  if (!isSafePublicId(userId)) return "invalid userId";
  if (profile.canonicalUserId && !isSafePublicId(profile.canonicalUserId)) return "invalid canonicalUserId";
  if (profile.lineUserId && !isSafePublicId(profile.lineUserId)) return "invalid lineUserId";
  if (profile.firebaseAuthUid && !isSafePublicId(profile.firebaseAuthUid)) return "invalid firebaseAuthUid";
  return null;
}

function validateSettingsRequest(body: SaveSettingsFromWebRequest) {
  if (!isSafePublicId(body.userId)) throw new SettingsValidationError("invalid userId");
  if (body.canonicalUserId && !isSafePublicId(body.canonicalUserId)) {
    throw new SettingsValidationError("invalid canonicalUserId");
  }
  if (body.lineUserId && !isSafePublicId(body.lineUserId)) throw new SettingsValidationError("invalid lineUserId");
  if (body.firebaseAuthUid && !isSafePublicId(body.firebaseAuthUid)) {
    throw new SettingsValidationError("invalid firebaseAuthUid");
  }
  if (body.config.mode !== "auto" && body.config.mode !== "custom") {
    throw new SettingsValidationError("invalid settings mode");
  }
}

function isSafePublicId(value: string) {
  return /^[A-Za-z0-9_.:@-]{2,128}$/.test(value);
}

function buildTargetFromSettingsConfig(config: SaveSettingsFromWebRequest["config"]) {
  let finalTdee = 0;
  let proteinPct = 30;
  let carbsPct = 40;
  let fatPct = 30;

  if (config.mode === "auto") {
    const weightKg = Number(config.weightKg ?? config.weight ?? 0);
    const heightCm = Number(config.heightCm ?? config.height ?? 0);
    const age = Number(config.age ?? 0);
    const activityFactor = Number(config.activityFactor ?? config.activity ?? 1.2);
    assertNumberInRange("weightKg", weightKg, 25, 300);
    assertNumberInRange("heightCm", heightCm, 100, 230);
    assertNumberInRange("age", age, 10, 100);
    assertNumberInRange("activityFactor", activityFactor, 1, 2.5);
    assertNumberInRange("goal", Number(config.goal ?? 0), -1000, 1000);

    let bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age);
    bmr += normalizeSettingsGender(config.gender) === "male" ? 5 : -161;
    finalTdee = Math.max(1200, Math.round((bmr * activityFactor) + Number(config.goal ?? 0)));
    ({ proteinPct, carbsPct, fatPct } = macroPercentagesForDietStyle(config.dietStyle));
  } else {
    finalTdee = Math.round(Number(config.tdee ?? 0));
    proteinPct = Number(config.p ?? 0);
    carbsPct = Number(config.c ?? 0);
    fatPct = Number(config.f ?? 0);
  }

  if (!Number.isFinite(finalTdee) || finalTdee < 800 || finalTdee > 6000) {
    throw new SettingsValidationError("invalid TDEE");
  }
  for (const [name, value] of Object.entries({ proteinPct, carbsPct, fatPct })) {
    assertNumberInRange(name, value, 1, 80);
  }
  const macroTotal = proteinPct + carbsPct + fatPct;
  if (macroTotal < 90 || macroTotal > 110) {
    throw new SettingsValidationError("macro percentages should add up close to 100");
  }
  const fiberG = Number(config.fiberG ?? 25);
  assertNumberInRange("fiberG", fiberG, 0, 100);

  return {
    calories: Math.round(finalTdee),
    proteinPct: Math.round(proteinPct),
    carbsPct: Math.round(carbsPct),
    fatPct: Math.round(fatPct),
    proteinG: Math.round((finalTdee * proteinPct / 100) / 4),
    carbsG: Math.round((finalTdee * carbsPct / 100) / 4),
    fatG: Math.round((finalTdee * fatPct / 100) / 9),
    fiberG: Math.round(fiberG)
  };
}

function assertNumberInRange(name: string, value: number, min: number, max: number) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new SettingsValidationError(`${name} must be between ${min} and ${max}`);
  }
}

function macroPercentagesForDietStyle(dietStyle: SaveSettingsFromWebRequest["config"]["dietStyle"]) {
  switch (dietStyle) {
    case "keto":
      return { proteinPct: 25, carbsPct: 5, fatPct: 70 };
    case "lowcarb":
      return { proteinPct: 40, carbsPct: 20, fatPct: 40 };
    case "highprotein":
      return { proteinPct: 40, carbsPct: 30, fatPct: 30 };
    case "ai_auto":
    case "balanced":
    default:
      return { proteinPct: 30, carbsPct: 40, fatPct: 30 };
  }
}

function normalizeSettingsGender(gender: SaveSettingsFromWebRequest["config"]["gender"]): "male" | "female" | "other" {
  if (gender === "male" || gender === "ชาย") return "male";
  if (gender === "female" || gender === "หญิง") return "female";
  return "other";
}

function inferGoalType(goalKcal: number): UpdateProfileRequest["goalType"] {
  if (goalKcal <= -350) return "fat_loss";
  if (goalKcal < 0) return "recomp";
  if (goalKcal >= 250) return "muscle_gain";
  return "maintain";
}

function sanitizeSettingsConfigForLog(config: SaveSettingsFromWebRequest["config"]) {
  return {
    mode: config.mode,
    gender: normalizeSettingsGender(config.gender),
    age: Number(config.age ?? 0) || null,
    heightCm: Number(config.heightCm ?? config.height ?? 0) || null,
    weightKg: Number(config.weightKg ?? config.weight ?? 0) || null,
    activityFactor: Number(config.activityFactor ?? config.activity ?? 0) || null,
    goal: Number(config.goal ?? 0) || 0,
    goalType: config.goalType ?? inferGoalType(Number(config.goal ?? 0)),
    dietStyle: config.dietStyle ?? null,
    tdee: Number(config.tdee ?? 0) || null,
    p: Number(config.p ?? 0) || null,
    c: Number(config.c ?? 0) || null,
    f: Number(config.f ?? 0) || null
  };
}

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

  const canonicalUserId = await resolveCanonicalUserId(body);
  const { startDate, endDate } = resolveDashboardRange(body);
  const history = buildDailyHistory(startDate, endDate);
  const profileSnap = await db.collection("profiles").doc(canonicalUserId).get();
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const target = normalizeTarget(profile);

  await fillMealHistory(canonicalUserId, startDate, endDate, history);
  await fillExerciseHistory(canonicalUserId, startDate, endDate, history);
  await fillWeightHistory(canonicalUserId, startDate, endDate, history);

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

  const [mealItems, exerciseItems, weightItems] = await Promise.all([
    listMealHistoryItems(canonicalUserId, startDate, endDate),
    listExerciseHistoryItems(canonicalUserId, startDate, endDate),
    listWeightHistoryItems(canonicalUserId, startDate, endDate)
  ]);
  const daily = labels.map((key) => ({
    date: key,
    calories: history[key].cal,
    proteinG: history[key].p,
    carbsG: history[key].c,
    fatG: history[key].f,
    fiberG: history[key].fib,
    burnedCalories: history[key].burn,
    dynamicTargetCalories: target.cal + history[key].burn,
    remainingCalories: target.cal + history[key].burn - history[key].cal,
    weightKg: history[key].weight,
    bodyFatPct: history[key].fat,
    muscleMassKg: history[key].muscle,
    deviceName: history[key].device
  }));

  response.json({
    ok: true,
    canonicalUserId,
    range: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      timezone: "Asia/Bangkok"
    },
    profile: {
      name: profile.displayName ?? "Member",
      target,
      streak: normalizeStreak(profile)
    },
    current: { weight: currentWeight, streak: normalizeStreak(profile) },
    labels,
    calories,
    bodyData: { weight: weights, fat: fats, muscle: muscles, devices },
    tdeeLine,
    macros,
    stats: {
      avgCal: totalCal / activeDays,
      totalDays: activeDays,
      successDays
    },
    daily,
    history: {
      meals: mealItems,
      exercises: exerciseItems,
      weights: weightItems,
      adjustments: mealItems.flatMap((meal) => meal.adjustments)
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

  try {
    const canonicalUserId = await resolveCanonicalUserId(body);
    const saved = await analyzeAndSaveMeal({ ...body, canonicalUserId, userId: canonicalUserId });

    response.json({
      ok: true,
      canonicalUserId,
      runId: saved.runId,
      mealLogId: saved.mealLogId,
      analysis: saved.mealLog
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: "meal-analysis-failed"
    });
  }
});

export const analyzeExercise = onRequest({ secrets: [GEMINI_API_KEY] }, async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as AnalyzeExerciseRequest;
  if (!body?.userId || !body?.source || !body?.text) {
    response.status(400).json({ ok: false, error: "invalid-request" });
    return;
  }

  try {
    const canonicalUserId = await resolveCanonicalUserId(body);
    const saved = await analyzeAndSaveExercise({ ...body, canonicalUserId, userId: canonicalUserId });

    response.json({
      ok: true,
      canonicalUserId,
      runId: saved.runId,
      exerciseLogId: saved.exerciseLogId,
      analysis: saved.exerciseLog
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: "exercise-analysis-failed"
    });
  }
});

export const lineWebhook = onRequest(
  { secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID, GEMINI_API_KEY] },
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
  const results = [];

  await db.collection("adminAuditLogs").add({
    type: "line-webhook-staging-received",
    eventCount: payload?.events?.length ?? 0,
    payload,
    status: "staging-processing",
    createdAt: now
  });

  for (const event of payload?.events ?? []) {
    try {
      results.push(await handleLineEvent(event));
    } catch (error) {
      await notifyAdminError("lineWebhook event processing failed", error);
      results.push({
        ok: false,
        type: event.type,
        status: "event-processing-failed",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  response.json({
    ok: true,
    received: payload?.events?.length ?? 0,
    results,
    status: "staging-line-text-image-enabled",
    warning: "This endpoint is still staging and is not a full production GAS replacement."
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

async function analyzeAndSaveMeal(request: AnalyzeMealRequest): Promise<SavedMealAnalysis> {
  const now = Timestamp.now();
  const aiRunRef = db.collection("aiRuns").doc();
  const agent = await getAiAgentConfig("mealAnalysis");
  if (!agent.enabled) {
    throw new Error("AI mealAnalysis agent is disabled");
  }
  if (agent.provider !== "gemini") {
    throw new Error(`Unsupported mealAnalysis provider: ${agent.provider}`);
  }

  await aiRunRef.set({
    runId: aiRunRef.id,
    userId: request.userId,
    canonicalUserId: request.canonicalUserId ?? request.userId,
    source: request.source,
    inputType: request.inputType,
    text: request.text ?? null,
    imageUrl: request.imageUrl ?? null,
    status: "running",
    createdAt: now,
    agentId: agent.agentId,
    provider: agent.provider,
    promptVersion: agent.promptVersion,
    model: agent.model
  });

  try {
    const analysis = await callGeminiMealAnalysis(request, GEMINI_API_KEY.value(), agent);
    const mealLogRef = db.collection("mealLogs").doc();
    const savedAt = Timestamp.now();

    const mealLog = {
      userId: request.userId,
      canonicalUserId: request.canonicalUserId ?? request.userId,
      source: request.source,
      inputType: request.inputType,
      text: request.text ?? null,
      imageUrl: request.imageUrl ?? null,
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
        agentId: agent.agentId,
        provider: agent.provider,
        model: agent.model,
        promptVersion: agent.promptVersion
      },
      loggedAt: savedAt,
      createdAt: savedAt,
      updatedAt: savedAt
    };

    const streak = await updateMealStreak(request.canonicalUserId ?? request.userId, savedAt);
    const mealLogWithStreak = {
      ...mealLog,
      streak
    };

    await mealLogRef.set(mealLogWithStreak);
    await aiRunRef.set(
      {
        status: "completed",
        mealLogId: mealLogRef.id,
        completedAt: savedAt,
        output: analysis
      },
      { merge: true }
    );

    return { runId: aiRunRef.id, mealLogId: mealLogRef.id, mealLog: mealLogWithStreak };
  } catch (error) {
    await aiRunRef.set(
      {
        status: "failed",
        failedAt: Timestamp.now(),
        error: error instanceof Error ? error.message : String(error)
      },
      { merge: true }
    );
    throw error;
  }
}

async function updateMealStreak(
  canonicalUserId: string,
  loggedAt: Timestamp
): Promise<{ count: number; lastMealLogDayKey: string; status: "started" | "continued" | "same-day" | "reset" }> {
  const profileRef = db.collection("profiles").doc(canonicalUserId);
  const dayKey = formatBangkokIsoDayKey(loggedAt.toDate());

  return db.runTransaction(async (transaction) => {
    const profileSnap = await transaction.get(profileRef);
    const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
    const previousStreak = (profile.streak ?? {}) as Record<string, unknown>;
    const previousDayKey = String(previousStreak.lastMealLogDayKey ?? "");
    const previousCount = Math.max(0, Number(previousStreak.count ?? 0));

    let nextCount = 1;
    let status: "started" | "continued" | "same-day" | "reset" = "started";
    if (previousDayKey === dayKey) {
      nextCount = previousCount || 1;
      status = "same-day";
    } else if (previousDayKey === getPreviousDayKey(dayKey)) {
      nextCount = previousCount + 1;
      status = "continued";
    } else if (previousDayKey) {
      nextCount = 1;
      status = "reset";
    }

    const now = Timestamp.now();
    const streak = {
      count: nextCount,
      lastMealLogDayKey: dayKey,
      updatedAt: now
    };
    transaction.set(
      profileRef,
      {
        userId: canonicalUserId,
        canonicalUserId,
        streak,
        updatedAt: now
      },
      { merge: true }
    );
    transaction.create(db.collection("profileEvents").doc(), {
      type: "meal-streak-updated",
      canonicalUserId,
      previousDayKey: previousDayKey || null,
      previousCount,
      status,
      streak,
      createdAt: now
    });

    return { count: nextCount, lastMealLogDayKey: dayKey, status };
  });
}

async function analyzeAndSaveExercise(request: AnalyzeExerciseRequest): Promise<SavedExerciseAnalysis> {
  const now = Timestamp.now();
  const aiRunRef = db.collection("aiRuns").doc();
  const agent = await getAiAgentConfig("exerciseAnalysis");
  if (!agent.enabled) {
    throw new Error("AI exerciseAnalysis agent is disabled");
  }
  if (agent.provider !== "gemini") {
    throw new Error(`Unsupported exerciseAnalysis provider: ${agent.provider}`);
  }

  await aiRunRef.set({
    runId: aiRunRef.id,
    userId: request.userId,
    canonicalUserId: request.canonicalUserId ?? request.userId,
    source: request.source,
    inputType: "exercise_text",
    text: request.text,
    status: "running",
    createdAt: now,
    agentId: agent.agentId,
    provider: agent.provider,
    promptVersion: agent.promptVersion,
    model: agent.model
  });

  try {
    const analysis = await callGeminiExerciseAnalysis(request, GEMINI_API_KEY.value(), agent);
    const exerciseLogRef = db.collection("exerciseLogs").doc();
    const savedAt = Timestamp.now();
    const rawCaloriesBurned = Math.max(0, Math.round(Number(analysis.calories_burned) || 0));
    const caloriesBurned = Math.round(rawCaloriesBurned * 0.5);

    const exerciseLog = {
      userId: request.userId,
      canonicalUserId: request.canonicalUserId ?? request.userId,
      source: request.source,
      text: request.text,
      activityName: String(analysis.activity_name || request.text),
      rawCaloriesBurned,
      caloriesBurned,
      safetyFactor: 0.5,
      commentTh: String(analysis.comment || ""),
      ai: {
        runId: aiRunRef.id,
        agentId: agent.agentId,
        provider: agent.provider,
        model: agent.model,
        promptVersion: agent.promptVersion
      },
      loggedAt: savedAt,
      createdAt: savedAt,
      updatedAt: savedAt
    };

    await exerciseLogRef.set(exerciseLog);
    await aiRunRef.set(
      {
        status: "completed",
        exerciseLogId: exerciseLogRef.id,
        completedAt: savedAt,
        output: analysis
      },
      { merge: true }
    );

    return { runId: aiRunRef.id, exerciseLogId: exerciseLogRef.id, exerciseLog };
  } catch (error) {
    await aiRunRef.set(
      {
        status: "failed",
        failedAt: Timestamp.now(),
        error: error instanceof Error ? error.message : String(error)
      },
      { merge: true }
    );
    throw error;
  }
}

async function analyzeAndSaveCoachConsultation(
  input: {
    userId: string;
    lineUserId: string;
    source: "line";
    text: string;
    mode: CoachConsultationRequest["mode"];
  }
): Promise<SavedCoachConsultation> {
  const profile = await getUserProfile(input.userId);
  const summary = await getTodaySummary(input.userId, profile);
  const recentMeals = await getRecentMealNames(input.userId, 5);
  const request: CoachConsultationRequest = {
    userId: input.userId,
    source: input.source,
    text: input.text,
    profileName: profile.name,
    target: {
      calories: profile.target.cal,
      proteinG: profile.target.p,
      carbsG: profile.target.c,
      fatG: profile.target.f,
      fiberG: profile.target.fib
    },
    today: {
      consumedCalories: summary.consumed.cal,
      consumedProteinG: summary.consumed.p,
      consumedCarbsG: summary.consumed.c,
      consumedFatG: summary.consumed.f,
      consumedFiberG: summary.consumed.fib,
      burnedCalories: summary.burned,
      dynamicTargetCalories: summary.dynamicTarget,
      remainingCalories: summary.remaining.cal,
      remainingProteinG: summary.remaining.p,
      remainingCarbsG: summary.remaining.c,
      remainingFatG: summary.remaining.f,
      remainingFiberG: summary.remaining.fib
    },
    recentMeals,
    mode: input.mode
  };

  const now = Timestamp.now();
  const aiRunRef = db.collection("aiRuns").doc();
  const agent = await getAiAgentConfig("coachConsultation");
  if (!agent.enabled) {
    throw new Error("AI coachConsultation agent is disabled");
  }
  if (agent.provider !== "gemini") {
    throw new Error(`Unsupported coachConsultation provider: ${agent.provider}`);
  }

  await aiRunRef.set({
    runId: aiRunRef.id,
    userId: input.userId,
    canonicalUserId: input.userId,
    lineUserId: input.lineUserId,
    source: input.source,
    inputType: input.mode,
    text: input.text,
    status: "running",
    createdAt: now,
    agentId: agent.agentId,
    provider: agent.provider,
    promptVersion: agent.promptVersion,
    model: agent.model
  });

  try {
    const answer = await callGeminiCoachConsultation(request, GEMINI_API_KEY.value(), agent);
    const consultationRef = db.collection("coachConsultations").doc();
    const savedAt = Timestamp.now();
    await consultationRef.set({
      consultationId: consultationRef.id,
      userId: input.userId,
      canonicalUserId: input.userId,
      lineUserId: input.lineUserId,
      source: input.source,
      mode: input.mode,
      question: input.text,
      answer,
      summarySnapshot: request.today,
      targetSnapshot: request.target,
      recentMeals,
      ai: {
        runId: aiRunRef.id,
        agentId: agent.agentId,
        provider: agent.provider,
        model: agent.model,
        promptVersion: agent.promptVersion
      },
      createdAt: savedAt,
      updatedAt: savedAt
    });
    await aiRunRef.set(
      {
        status: "completed",
        consultationId: consultationRef.id,
        completedAt: savedAt,
        output: { answer }
      },
      { merge: true }
    );
    return {
      runId: aiRunRef.id,
      consultationId: consultationRef.id,
      answer,
      mode: input.mode
    };
  } catch (error) {
    await aiRunRef.set(
      {
        status: "failed",
        failedAt: Timestamp.now(),
        error: error instanceof Error ? error.message : String(error)
      },
      { merge: true }
    );
    throw error;
  }
}

type LineEvent = LineWebhookEvent["events"][number];

async function handleLineEvent(event: LineEvent) {
  const lineUserId = event.source?.userId;
  const replyToken = event.replyToken;

  if (!lineUserId || !replyToken) {
    return { ok: false, type: event.type, reason: "missing-user-or-reply-token" };
  }

  if (event.message?.id && !(await markLineMessageIfNew(event.message.id))) {
    return { ok: true, type: event.type, status: "duplicate-skipped" };
  }

  if (event.type === "follow") {
    const result = await handleFollowEvent(replyToken, lineUserId);
    return { ok: true, type: event.type, ...result };
  }

  if (event.type !== "message") {
    return { ok: true, type: event.type, status: "ignored" };
  }

  if (event.message?.type === "image") {
    const canonicalUserId = await resolveLineCanonicalUserId(lineUserId);
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { ok: true, type: event.type, canonicalUserId, status: "profile-required-before-image" };
    }
    return handleLineImageMessage(event, replyToken, canonicalUserId, lineUserId, readiness);
  }

  if (event.message?.type === "file") {
    const canonicalUserId = await resolveLineCanonicalUserId(lineUserId);
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { ok: true, type: event.type, canonicalUserId, status: "profile-required-before-file" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ ต้องต่ออายุก่อนส่งไฟล์ BIA/PDF");
      return { ok: true, type: event.type, canonicalUserId, status: "subscription-required-before-file" };
    }
    return handleLineFileMessage(event, replyToken, canonicalUserId, lineUserId);
  }

  if (event.message?.type !== "text") {
    await replyToLine(replyToken, "ระบบ Firebase staging ตอนนี้รองรับข้อความอาหารและรูปอาหารเท่านั้น ไฟล์/PDF/BIA จะยังใช้ระบบ GAS เดิมจนกว่า parity จะครบครับ");
    return { ok: true, type: event.type, status: "unsupported-message-replied" };
  }

  const text = event.message.text?.trim();
  if (!text) {
    await replyToLine(replyToken, "ยังไม่พบข้อความอาหารครับ");
    return { ok: false, type: event.type, status: "empty-text" };
  }

  if (lineUserId === ADMIN_LINE_USER_ID.value()) {
    const adminResult = await handleAdminTextCommand(text, replyToken, lineUserId);
    if (adminResult) {
      return { ok: true, type: event.type, ...adminResult };
    }
  }

  const canonicalUserId = await resolveLineCanonicalUserId(lineUserId);
  const forwardedToAdmin = await forwardCustomerReplyIfAdminChatActive(text, lineUserId, canonicalUserId);
  if (forwardedToAdmin) {
    return { ok: true, type: event.type, canonicalUserId, status: "customer-reply-forwarded-to-admin" };
  }

  const commandResult = await handleLineTextCommand(text, replyToken, canonicalUserId, lineUserId);
  if (commandResult) {
    return { ok: true, type: event.type, canonicalUserId, ...commandResult };
  }

  if (isKnownLegacyCommand(text)) {
    await replyToLine(replyToken, "คำสั่งนี้ยังอยู่ในระบบ GAS production เดิมครับ Firebase staging ยังไม่พร้อมแทนที่คำสั่งนี้");
    return { ok: true, type: event.type, status: "legacy-command-deferred" };
  }

  const readiness = await getUserReadiness(canonicalUserId);
  if (!readiness.profileComplete) {
    await replyWithOnboarding(replyToken, lineUserId);
    return { ok: true, type: event.type, canonicalUserId, status: "profile-required-before-meal" };
  }
  if (!readiness.subscriptionActive) {
    await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
    return { ok: true, type: event.type, canonicalUserId, status: "subscription-required-before-meal" };
  }

  try {
    const saved = await analyzeAndSaveMeal({
      userId: canonicalUserId,
      canonicalUserId,
      source: "line",
      inputType: "text",
      text
    });

    await replyToLine(replyToken, formatMealReply(saved.mealLog));
    return {
      ok: true,
      type: event.type,
      status: "meal-analyzed-and-replied",
      canonicalUserId,
      runId: saved.runId,
      mealLogId: saved.mealLogId
    };
  } catch (error) {
    await replyToLine(replyToken, "ขออภัยครับ ระบบวิเคราะห์อาหารฝั่ง staging เกิดข้อผิดพลาด กรุณาใช้ระบบเดิมต่อก่อนครับ");
    return {
      ok: false,
      type: event.type,
      status: "meal-analysis-failed",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function markLineMessageIfNew(messageId: string): Promise<boolean> {
  try {
    await db.collection("lineEventDedup").doc(messageId).create({
      messageId,
      createdAt: Timestamp.now()
    });
    return true;
  } catch {
    return false;
  }
}

async function handleLineImageMessage(
  event: LineEvent,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string,
  readiness: UserReadiness
): Promise<Record<string, unknown>> {
  const messageId = event.message?.id;
  if (!messageId) {
    await replyToLine(replyToken, "ไม่พบรหัสรูปภาพจาก LINE ครับ กรุณาส่งรูปอาหารอีกครั้ง");
    return { ok: false, type: event.type, status: "missing-image-message-id" };
  }

  await showLoadingAnimation(lineUserId, 20);

  try {
    const content = await downloadLineContent(messageId);
    const classification = await classifyLineImage(content.base64, content.mimeType);

    if (classification.type === "slip") {
      const result = await handleSlipPaymentImage({
        replyToken,
        canonicalUserId,
        lineUserId,
        messageId,
        mimeType: content.mimeType,
        slipData: classification.slip_data ?? {}
      });
      return {
        ok: true,
        type: event.type,
        status: "slip-payment-review-created",
        canonicalUserId,
        paymentReviewId: result.paymentReviewId
      };
    }

    if (classification.type === "bia") {
      if (!readiness.subscriptionActive) {
        await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ ต้องต่ออายุก่อนส่งรายงาน BIA");
        return { ok: true, type: event.type, status: "subscription-required-before-bia-image", canonicalUserId };
      }

      const result = await createBiaReportReview({
        replyToken,
        canonicalUserId,
        lineUserId,
        messageId,
        fileName: "LINE image BIA report",
        mimeType: content.mimeType,
        base64: content.base64,
        source: "line-image",
        imageType: classification.type
      });
      return {
        ok: true,
        type: event.type,
        status: "bia-report-review-created",
        canonicalUserId,
        biaReportId: result.biaReportId
      };
    }

    if (classification.type === "leftover") {
      if (!readiness.subscriptionActive) {
        await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ (ส่งสลิปได้ แต่ยังหักของเหลือไม่ได้)");
        return { ok: true, type: event.type, status: "subscription-required-before-leftover-image", canonicalUserId };
      }

      const result = await subtractLatestMealLeftover({
        canonicalUserId,
        lineUserId,
        messageId,
        imageBase64: content.base64,
        mimeType: content.mimeType
      });
      await replyToLine(replyToken, result.message);
      return {
        ok: true,
        type: event.type,
        status: result.subtracted ? "leftover-subtracted" : "leftover-subtraction-not-found",
        canonicalUserId,
        mealLogId: result.mealLogId,
        aiRunId: result.aiRunId
      };
    }

    if (classification.type === "other") {
      await replyToLine(replyToken, "รูปนี้ยังไม่ใช่อาหาร/สลิป/BIA ที่ระบบ staging รองรับครับ กรุณาส่งรูปอาหารหรือสลิปโอนเงิน");
      return { ok: true, type: event.type, status: "other-image-replied", canonicalUserId };
    }

    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ (ส่งสลิปได้ แต่ยังวิเคราะห์อาหารไม่ได้)");
      return { ok: true, type: event.type, status: "subscription-required-before-image-food", canonicalUserId };
    }

    const saved = await analyzeAndSaveMeal({
      userId: canonicalUserId,
      canonicalUserId,
      source: "line",
      inputType: "image",
      text: "LINE image food analysis",
      imageUrl: `line-message://${messageId}`,
      imageBase64: content.base64,
      mimeType: content.mimeType
    });

    await replyToLine(replyToken, formatMealReply(saved.mealLog));
    return {
      ok: true,
      type: event.type,
      status: "image-meal-analyzed-and-replied",
      canonicalUserId,
      runId: saved.runId,
      mealLogId: saved.mealLogId,
      mimeType: content.mimeType,
      imageType: classification.type
    };
  } catch (error) {
    await replyToLine(replyToken, "ขออภัยครับ ระบบวิเคราะห์รูปอาหารฝั่ง staging เกิดข้อผิดพลาด กรุณาใช้ระบบเดิมต่อก่อนครับ");
    return {
      ok: false,
      type: event.type,
      status: "image-meal-analysis-failed",
      canonicalUserId,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function handleLineFileMessage(
  event: LineEvent,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown>> {
  const messageId = event.message?.id;
  const fileName = event.message?.fileName || "LINE file";
  if (!messageId) {
    await replyToLine(replyToken, "ไม่พบรหัสไฟล์จาก LINE ครับ กรุณาส่งไฟล์อีกครั้ง");
    return { ok: false, type: event.type, status: "missing-file-message-id" };
  }

  await showLoadingAnimation(lineUserId, 10);

  try {
    const content = await downloadLineContent(messageId);
    if (!isSupportedBiaFile(fileName, content.mimeType)) {
      await replyToLine(replyToken, "ตอนนี้ Firebase staging รองรับไฟล์ BIA เป็น PDF หรือรูปภาพเท่านั้นครับ");
      await db.collection("lineUnsupportedFiles").add({
        canonicalUserId,
        lineUserId,
        messageId,
        fileName,
        mimeType: content.mimeType,
        createdAt: Timestamp.now()
      });
      return { ok: true, type: event.type, status: "unsupported-file-replied", canonicalUserId };
    }

    const result = await createBiaReportReview({
      replyToken,
      canonicalUserId,
      lineUserId,
      messageId,
      fileName,
      mimeType: content.mimeType,
      base64: content.base64,
      source: "line-file"
    });
    return {
      ok: true,
      type: event.type,
      status: "bia-file-review-created",
      canonicalUserId,
      biaReportId: result.biaReportId
    };
  } catch (error) {
    await replyToLine(replyToken, "ขออภัยครับ ระบบรับไฟล์ BIA/PDF ฝั่ง staging เกิดข้อผิดพลาด กรุณาใช้ระบบเดิมต่อก่อนครับ");
    return {
      ok: false,
      type: event.type,
      status: "bia-file-review-failed",
      canonicalUserId,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function isSupportedBiaFile(fileName: string, mimeType: string): boolean {
  const lowerName = fileName.toLowerCase();
  const lowerMime = mimeType.toLowerCase();
  return lowerMime.includes("pdf") ||
    lowerMime.startsWith("image/") ||
    lowerName.endsWith(".pdf") ||
    /\.(jpg|jpeg|png|webp)$/i.test(lowerName);
}

async function createBiaReportReview(input: {
  replyToken: string;
  canonicalUserId: string;
  lineUserId: string;
  messageId: string;
  fileName: string;
  mimeType: string;
  base64: string;
  source: "line-image" | "line-file";
  imageType?: string;
}): Promise<{ biaReportId: string }> {
  const now = Timestamp.now();
  const profile = await getUserProfile(input.canonicalUserId);
  const reportRef = db.collection("biaReports").doc();
  await reportRef.set({
    biaReportId: reportRef.id,
    canonicalUserId: input.canonicalUserId,
    lineUserId: input.lineUserId,
    displayName: profile.name,
    status: "pending-analysis",
    source: input.source,
    lineMessageId: input.messageId,
    fileName: input.fileName,
    fileUrl: `line-message://${input.messageId}`,
    mimeType: input.mimeType,
    imageType: input.imageType ?? null,
    createdAt: now,
    updatedAt: now
  });

  await db.collection("adminAuditLogs").add({
    type: "bia-report-submitted",
    biaReportId: reportRef.id,
    canonicalUserId: input.canonicalUserId,
    lineUserId: input.lineUserId,
    source: input.source,
    fileName: input.fileName,
    mimeType: input.mimeType,
    createdAt: now
  });

  try {
    const analysis = await analyzeBiaReport(input.base64, input.mimeType, profile);
    const savedAt = Timestamp.now();
    await reportRef.set({
      status: "analysis-completed",
      analysis,
      analyzedAt: savedAt,
      updatedAt: savedAt
    }, { merge: true });

    await saveWeightLogFromBia(input.canonicalUserId, analysis, savedAt);
    await db.collection("profileEvents").add({
      type: "bia-analysis",
      biaReportId: reportRef.id,
      canonicalUserId: input.canonicalUserId,
      lineUserId: input.lineUserId,
      analysis,
      createdAt: savedAt
    });

    await replyToLine(input.replyToken, formatBiaAnalysisReply(reportRef.id, profile, analysis));
    await pushMessage(ADMIN_LINE_USER_ID.value(), [
      "วิเคราะห์ BIA/สุขภาพสำเร็จ",
      `ลูกค้า: ${profile.name}`,
      `LINE User ID: ${input.lineUserId}`,
      `Canonical ID: ${input.canonicalUserId}`,
      `BIA Report ID: ${reportRef.id}`,
      `น้ำหนัก: ${analysis.metrics?.weight_kg ?? "-"} kg`,
      `Fat: ${analysis.metrics?.fat_pct ?? "-"}% | Muscle: ${analysis.metrics?.muscle_kg ?? "-"} kg`,
      `แนะนำ TDEE: ${analysis.recommendation?.suggested_tdee ?? "-"} kcal`,
      "",
      "รอ user ยืนยันก่อนปรับ profile target"
    ].join("\n"));
  } catch (error) {
    const failedAt = Timestamp.now();
    await reportRef.set({
      status: "analysis-failed",
      error: error instanceof Error ? error.message : String(error),
      failedAt,
      updatedAt: failedAt
    }, { merge: true });

    await replyToLine(input.replyToken, [
      "ได้รับรายงาน BIA/สุขภาพแล้วครับ",
      "แต่ระบบ staging ยังวิเคราะห์ไฟล์นี้ไม่สำเร็จ จึงบันทึกไว้ให้แอดมินตรวจต่อ",
      `รหัสรายการ: ${reportRef.id}`
    ].join("\n"));

    await pushMessage(ADMIN_LINE_USER_ID.value(), [
      "มีรายงาน BIA/สุขภาพรอตรวจแบบ manual",
      `ลูกค้า: ${profile.name}`,
      `LINE User ID: ${input.lineUserId}`,
      `Canonical ID: ${input.canonicalUserId}`,
      `ไฟล์: ${input.fileName}`,
      `ชนิด: ${input.mimeType}`,
      `BIA Report ID: ${reportRef.id}`,
      `Error: ${error instanceof Error ? error.message : String(error)}`
    ].join("\n"));
  }

  return { biaReportId: reportRef.id };
}

async function analyzeBiaReport(base64: string, mimeType: string, profile: UserProfile) {
  const agent = await getAiAgentConfig("biaAnalysis");
  if (!agent.enabled) {
    throw new Error("AI biaAnalysis agent is disabled");
  }
  if (agent.provider !== "gemini") {
    throw new Error(`Unsupported BIA provider: ${agent.provider}`);
  }

  return callGeminiBiaAnalysis({
    base64,
    mimeType,
    displayName: profile.name,
    currentTargetCal: profile.target.cal
  }, GEMINI_API_KEY.value(), agent);
}

async function saveWeightLogFromBia(
  canonicalUserId: string,
  analysis: Awaited<ReturnType<typeof analyzeBiaReport>>,
  loggedAt: Timestamp
): Promise<void> {
  const metrics = analysis.metrics ?? {};
  const weightKg = Number(metrics.weight_kg ?? 0);
  if (!weightKg) return;

  await db.collection("weightLogs").add({
    userId: canonicalUserId,
    canonicalUserId,
    source: "line-bia",
    weightKg,
    bodyFatPct: Number(metrics.fat_pct ?? 0) || null,
    muscleMassKg: Number(metrics.muscle_kg ?? 0) || null,
    bmr: Number(metrics.bmr ?? 0) || null,
    visceralFatLevel: Number(metrics.visceral_lvl ?? 0) || null,
    deviceName: analysis.meta?.device_name || "BIA Report",
    loggedAt,
    createdAt: loggedAt,
    updatedAt: loggedAt
  });

  await db.collection("profiles").doc(canonicalUserId).set({
    weightKg,
    updatedAt: loggedAt
  }, { merge: true });
}

async function classifyLineImage(base64: string, mimeType: string) {
  const agent = await getAiAgentConfig("mealAnalysis");
  if (!agent.enabled || agent.provider !== "gemini") {
    return { type: "food" as const, confidence: 0 };
  }

  try {
    return await callGeminiImageClassification(base64, mimeType, GEMINI_API_KEY.value(), agent);
  } catch (error) {
    await db.collection("adminAuditLogs").add({
      type: "image-classification-failed",
      error: error instanceof Error ? error.message : String(error),
      createdAt: Timestamp.now()
    });
    return { type: "food" as const, confidence: 0 };
  }
}

async function handleSlipPaymentImage(input: {
  replyToken: string;
  canonicalUserId: string;
  lineUserId: string;
  messageId: string;
  mimeType: string;
  slipData: Record<string, unknown>;
}): Promise<{ paymentReviewId: string }> {
  const now = Timestamp.now();
  const profile = await getUserProfile(input.canonicalUserId);
  const reviewRef = db.collection("paymentReviews").doc();
  const amount = Number(input.slipData.amount ?? 0) || null;
  await reviewRef.set({
    paymentReviewId: reviewRef.id,
    canonicalUserId: input.canonicalUserId,
    lineUserId: input.lineUserId,
    displayName: profile.name,
    status: "pending-admin-review",
    source: "line-image",
    lineMessageId: input.messageId,
    imageUrl: `line-message://${input.messageId}`,
    mimeType: input.mimeType,
    slipData: {
      amount,
      date: String(input.slipData.date ?? ""),
      time: String(input.slipData.time ?? ""),
      receiverName: String(input.slipData.receiver_name ?? ""),
      bankFrom: String(input.slipData.bank_from ?? ""),
      bankTo: String(input.slipData.bank_to ?? "")
    },
    createdAt: now,
    updatedAt: now
  });

  await db.collection("subscriptionEvents").add({
    type: "slip-submitted",
    paymentReviewId: reviewRef.id,
    canonicalUserId: input.canonicalUserId,
    lineUserId: input.lineUserId,
    amount,
    createdAt: now
  });

  await replyToLine(input.replyToken, [
    "ได้รับสลิปแล้วครับ",
    amount ? `ยอดเงินที่อ่านได้: ${amount} บาท` : "ยังอ่านยอดเงินไม่ได้ชัดเจน",
    "ระบบส่งให้แอดมินตรวจสอบแล้ว กรุณารอสักครู่นะครับ"
  ].join("\n"));

  await pushMessage(ADMIN_LINE_USER_ID.value(), [
    "มีสลิปโอนเงินใหม่รอตรวจ",
    `ลูกค้า: ${profile.name}`,
    `LINE User ID: ${input.lineUserId}`,
    `Canonical ID: ${input.canonicalUserId}`,
    amount ? `ยอดที่อ่านได้: ${amount} บาท` : "ยอดที่อ่านได้: -",
    `Review ID: ${reviewRef.id}`,
    "",
    `อนุมัติ 30 วัน: อนุมัติ ${input.lineUserId} 30`,
    `อนุมัติ 90 วัน: อนุมัติ ${input.lineUserId} 90`,
    `ปฏิเสธ: ปฏิเสธ ${input.lineUserId}`
  ].join("\n"));

  return { paymentReviewId: reviewRef.id };
}

function isKnownLegacyCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith("code") ||
    text.startsWith("ตั้งค่า") ||
    text.startsWith("โค้ด") ||
    text.startsWith("เติมโค้ด") ||
    text.includes("เติมวัน") ||
    text.includes("สมัคร") ||
    text.includes("กินไรดี") ||
    text.includes("แนะนำ");
}

async function handleAdminTextCommand(
  text: string,
  replyToken: string,
  adminLineUserId: string
): Promise<Record<string, unknown> | null> {
  const activeChat = await getActiveAdminChat(adminLineUserId);
  const subscriptionCommand = parseAdminSubscriptionCommand(text);
  if (subscriptionCommand) {
    const result = await handleAdminSubscriptionCommand(subscriptionCommand, replyToken, adminLineUserId);
    return { status: `admin-subscription-${subscriptionCommand.action}`, ...result };
  }

  if (text === "จบ" || text === "ออก" || text.toLowerCase() === "exit") {
    if (!activeChat) {
      await replyToLine(replyToken, "ไม่ได้อยู่ในโหมดคุยครับ");
      return { status: "admin-chat-not-active" };
    }

    await db.collection("adminChatSessions").doc(adminLineUserId).set(
      {
        status: "closed",
        closedAt: Timestamp.now(),
        updatedAt: Timestamp.now()
      },
      { merge: true }
    );
    await replyToLine(replyToken, "จบการสนทนา กลับสู่โหมดบอทปกติแล้วครับ");
    return { status: "admin-chat-closed", targetLineUserId: activeChat.targetLineUserId };
  }

  if (activeChat) {
    await pushMessage(activeChat.targetLineUserId, `Admin: ${text}`);
    await db.collection("adminChatMessages").add({
      adminLineUserId,
      targetLineUserId: activeChat.targetLineUserId,
      direction: "admin-to-customer",
      text,
      createdAt: Timestamp.now()
    });
    return { status: "admin-message-forwarded", targetLineUserId: activeChat.targetLineUserId };
  }

  if (text.startsWith("คุย")) {
    const targetLineUserId = text.split(/\s+/)[1]?.trim();
    if (!targetLineUserId) {
      await replyToLine(replyToken, "กรุณาระบุ User ID เช่น `คุย Uxxxxxxxx`");
      return { status: "admin-chat-missing-target" };
    }

    const expiresAt = Timestamp.fromMillis(Date.now() + 30 * 60 * 1000);
    await db.collection("adminChatSessions").doc(adminLineUserId).set({
      adminLineUserId,
      targetLineUserId,
      status: "active",
      expiresAt,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now()
    });
    await replyToLine(replyToken, `เริ่มแชทกับลูกค้า ${targetLineUserId}\nทุกข้อความที่คุณพิมพ์จะส่งไปหาเขา\nพิมพ์ "จบ" เพื่อออก`);
    return { status: "admin-chat-started", targetLineUserId };
  }

  return null;
}

async function handleLineTextCommand(
  text: string,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown> | null> {
  const lower = text.toLowerCase();

  if (text.startsWith("CONFIRM_UPDATE_TARGET")) {
    const result = await handleConfirmUpdateTarget(text, replyToken, canonicalUserId, lineUserId);
    return { status: "target-update-confirmed", ...result };
  }

  if (text === "ไม่ปรับเป้าหมาย") {
    await replyToLine(replyToken, "รับทราบครับ ใช้เป้าหมายเดิมต่อไปครับ");
    await db.collection("profileEvents").add({
      type: "target-update-declined",
      canonicalUserId,
      lineUserId,
      createdAt: Timestamp.now()
    });
    return { status: "target-update-declined" };
  }

  if (isSubscriptionRequestCommand(text)) {
    const result = await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId);
    return { status: "subscription-request-replied", ...result };
  }

  if (isRedeemCodeCommand(text)) {
    const result = await handleRedeemCode(text, replyToken, canonicalUserId, lineUserId);
    return { status: "redeem-code-processed", ...result };
  }

  if (isManualProfileSetupCommand(text)) {
    const result = await handleManualProfileSetup(text, replyToken, canonicalUserId, lineUserId);
    return { status: "manual-profile-setup", ...result };
  }

  if (text.startsWith("ติดต่อ") || text.startsWith("แอดมิน") || lower.startsWith("admin")) {
    const result = await handleContactAdmin(text, replyToken, canonicalUserId, lineUserId);
    return { status: "contact-admin-forwarded", ...result };
  }

  if (text.includes("คู่มือ") || text.includes("วิธีใช้") || lower.includes("help")) {
    await replyToLine(replyToken, formatHelpReply());
    return { status: "help-replied" };
  }

  if (text === "ออกกำลังกาย") {
    await replyToLine(replyToken, formatExerciseGuideReply());
    return { status: "exercise-guide-replied" };
  }

  const portionAdjustment = parsePortionAdjustment(text);
  if (portionAdjustment) {
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-portion-adjustment" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-portion-adjustment" };
    }

    const result = await adjustLatestMealPortion(canonicalUserId, portionAdjustment, text);
    await replyToLine(replyToken, result.message);
    return { status: result.adjusted ? "meal-portion-adjusted" : "meal-portion-adjustment-not-found" };
  }

  const correctionText = parseMealCorrectionText(text);
  if (correctionText) {
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-meal-correction" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-meal-correction" };
    }

    const result = await replaceLatestMealWithCorrection(canonicalUserId, correctionText, text);
    await replyToLine(replyToken, result.message);
    return {
      status: result.corrected ? "meal-correction-applied" : "meal-correction-not-found",
      runId: result.runId,
      mealLogId: result.mealLogId
    };
  }

  if (looksLikeMenuRecommendationRequest(text) || looksLikeCoachConsultationRequest(text)) {
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-coach-consultation" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-coach-consultation" };
    }

    const mode = looksLikeMenuRecommendationRequest(text) ? "menu_recommendation" : "consultation";
    const saved = await analyzeAndSaveCoachConsultation({
      userId: canonicalUserId,
      lineUserId,
      source: "line",
      text,
      mode
    });
    await replyToLine(replyToken, formatCoachConsultationReply(saved.answer, saved.mode));
    return {
      status: mode === "menu_recommendation" ? "menu-recommendation-replied" : "coach-consultation-replied",
      runId: saved.runId,
      consultationId: saved.consultationId
    };
  }

  if (looksLikeExerciseLog(text)) {
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-exercise" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-exercise" };
    }

    const saved = await analyzeAndSaveExercise({
      userId: canonicalUserId,
      canonicalUserId,
      source: "line",
      text
    });
    const profile = await getUserProfile(canonicalUserId);
    const summary = await getTodaySummary(canonicalUserId, profile);
    await replyToLine(replyToken, formatExerciseReply(saved.exerciseLog, summary));
    return {
      status: "exercise-logged",
      runId: saved.runId,
      exerciseLogId: saved.exerciseLogId
    };
  }

  if (text.includes("ข้อมูลส่วนตัว") || text.includes("เช็คสถานะ") || lower.includes("setting")) {
    const profile = await getUserProfile(canonicalUserId);
    await replyToLine(replyToken, formatProfileReply(profile));
    return { status: "profile-replied" };
  }

  if (text.includes("กราฟ") || text.includes("ประวัติ") || lower.includes("report") || lower.includes("dashboard")) {
    await replyToLine(replyToken, formatDashboardReply(lineUserId));
    return { status: "dashboard-link-replied" };
  }

  if (text.includes("สรุป") || text.includes("ยอด")) {
    const profile = await getUserProfile(canonicalUserId);
    const summary = await getTodaySummary(canonicalUserId, profile);
    await replyToLine(replyToken, formatDailySummaryReply(profile, summary));
    return { status: "daily-summary-replied" };
  }

  if (text === "ลบ" || text === "ยกเลิก" || lower === "undo") {
    const result = await deleteLastMealLog(canonicalUserId);
    await replyToLine(replyToken, result.message);
    return { status: result.deleted ? "last-meal-deleted" : "last-meal-not-found" };
  }

  if (text.startsWith("หนัก") || text.startsWith("น้ำหนัก") || lower.startsWith("weight")) {
    const parsed = parseWeightCommand(text);
    if (!parsed) {
      await replyToLine(replyToken, "รูปแบบน้ำหนักยังไม่ถูกต้องครับ เช่น `หนัก 65 fat 20 muscle 28`");
      return { status: "weight-log-invalid" };
    }

    await saveWeightLog(canonicalUserId, parsed);
    await replyToLine(replyToken, formatWeightReply(parsed));
    return { status: "weight-logged" };
  }

  return null;
}

async function handleFollowEvent(replyToken: string, lineUserId: string): Promise<Record<string, unknown>> {
  const canonicalUserId = await resolveLineCanonicalUserId(lineUserId);
  const lineProfile = await getLineProfile(lineUserId);
  const readiness = await getUserReadiness(canonicalUserId);
  const now = Timestamp.now();
  const profileUpdate: Record<string, unknown> = {
    userId: canonicalUserId,
    canonicalUserId,
    lineUserId,
    updatedAt: now,
    createdAt: now
  };
  if (!readiness.profileComplete) {
    profileUpdate.displayName = lineProfile.displayName;
  }

  await Promise.all([
    db.collection("users").doc(canonicalUserId).set({
      userId: canonicalUserId,
      canonicalUserId,
      status: readiness.profileComplete ? "active" : "needs_profile",
      source: { line: true, app: false },
      updatedAt: now,
      createdAt: now
    }, { merge: true }),
    db.collection("profiles").doc(canonicalUserId).set(profileUpdate, { merge: true })
  ]);

  if (!readiness.profileComplete) {
    await replyWithOnboarding(replyToken, lineUserId, lineProfile.displayName);
    return { status: "follow-onboarding-replied", canonicalUserId };
  }

  if (!readiness.subscriptionActive) {
    await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "ยินดีต้อนรับกลับครับ แต่วันใช้งานหมดแล้ว");
    return { status: "follow-subscription-replied", canonicalUserId };
  }

  await replyToLine(replyToken, `ยินดีต้อนรับกลับครับคุณ ${lineProfile.displayName}\nพิมพ์อาหารหรือส่งรูปอาหารได้เลยครับ`);
  return { status: "follow-ready-replied", canonicalUserId };
}

function isSubscriptionRequestCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.includes("subscribe") ||
    lower.includes("renew") ||
    text.includes("สมัคร") ||
    text.includes("เติมวัน");
}

function isRedeemCodeCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return lower.startsWith("code") ||
    text.startsWith("โค้ด") ||
    text.startsWith("เติมโค้ด");
}

function isManualProfileSetupCommand(text: string): boolean {
  return text.startsWith("ตั้งค่า");
}

async function handleConfirmUpdateTarget(
  text: string,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown>> {
  const parts = text.split(/\s+/);
  const calories = Number(parts[1]);
  const macros = parts[2]?.split("-").map((part) => Number(part)) ?? [];
  if (!Number.isFinite(calories) || calories < 800 || calories > 6000 || macros.length !== 3 || macros.some((value) => !Number.isFinite(value) || value <= 0)) {
    await replyToLine(replyToken, "รูปแบบยืนยันเป้าหมายไม่ถูกต้องครับ เช่น `CONFIRM_UPDATE_TARGET 2200 150-200-60`");
    return { updated: false, reason: "invalid-target-confirmation" };
  }

  const [proteinG, carbsG, fatG] = macros;
  const now = Timestamp.now();
  const target = {
    calories: Math.round(calories),
    proteinG: Math.round(proteinG),
    carbsG: Math.round(carbsG),
    fatG: Math.round(fatG),
    fiberG: 25
  };
  await Promise.all([
    db.collection("profiles").doc(canonicalUserId).set({
      target,
      updatedAt: now
    }, { merge: true }),
    db.collection("profileEvents").add({
      type: "target-update-confirmed",
      canonicalUserId,
      lineUserId,
      target,
      source: "line-confirm-command",
      createdAt: now
    })
  ]);

  await replyToLine(replyToken, [
    "ปรับเป้าหมายเรียบร้อยครับ",
    `TDEE: ${target.calories} kcal`,
    `P:${target.proteinG}g C:${target.carbsG}g F:${target.fatG}g`
  ].join("\n"));

  return { updated: true, target };
}

async function handleManualProfileSetup(
  text: string,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown>> {
  const parsed = await parseManualProfileSetup(text, canonicalUserId, lineUserId);
  if (!parsed) {
    await replyToLine(replyToken, [
      "รูปแบบคำสั่งตั้งค่ายังไม่ถูกต้องครับ",
      "ตัวอย่าง:",
      "ตั้งค่า แชมป์ 2000 40-30-30",
      "ตั้งค่า 2000 40-30-30"
    ].join("\n"));
    return { updated: false, reason: "invalid-profile-setup" };
  }

  const now = Timestamp.now();
  const existingExpiry = await getSubscriptionExpiry(canonicalUserId);
  const expiresAt = existingExpiry ?? subscriptionExpiryAfterDays(3, null);
  await Promise.all([
    db.collection("profiles").doc(canonicalUserId).set({
      userId: canonicalUserId,
      canonicalUserId,
      lineUserId,
      displayName: parsed.displayName,
      target: parsed.target,
      updatedAt: now,
      createdAt: now
    }, { merge: true }),
    db.collection("users").doc(canonicalUserId).set({
      userId: canonicalUserId,
      canonicalUserId,
      status: "active",
      source: { line: true, app: false },
      updatedAt: now,
      createdAt: now
    }, { merge: true }),
    db.collection("subscriptions").doc(canonicalUserId).set({
      userId: canonicalUserId,
      canonicalUserId,
      status: expiresAt.toMillis() >= Date.now() ? "active" : "expired",
      expiresAt,
      trialGranted: existingExpiry ? false : true,
      updatedAt: now,
      createdAt: now
    }, { merge: true }),
    db.collection("profileEvents").add({
      type: "manual-line-setup",
      canonicalUserId,
      lineUserId,
      displayName: parsed.displayName,
      target: parsed.target,
      createdAt: now
    })
  ]);

  await replyToLine(replyToken, [
    "ตั้งค่าเป้าหมายเรียบร้อยครับ",
    `คุณ: ${parsed.displayName}`,
    `TDEE: ${parsed.target.calories} kcal`,
    `P:${parsed.target.proteinG}g C:${parsed.target.carbsG}g F:${parsed.target.fatG}g`,
    existingExpiry ? `หมดอายุ: ${formatBangkokDate(expiresAt.toDate())}` : `เริ่มทดลองใช้ฟรีถึง: ${formatBangkokDate(expiresAt.toDate())}`
  ].join("\n"));

  return { updated: true, trialGranted: !existingExpiry, expiresAt: expiresAt.toDate().toISOString() };
}

async function parseManualProfileSetup(
  text: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<{
  displayName: string;
  target: { calories: number; proteinPct: number; carbsPct: number; fatPct: number; proteinG: number; carbsG: number; fatG: number; fiberG: number };
} | null> {
  const parts = text.split(/\s+/).filter(Boolean);
  if (parts.length < 3) return null;

  const ratioText = parts[parts.length - 1];
  const tdee = Number(parts[parts.length - 2]);
  const ratios = ratioText.split("-").map((part) => Number(part));
  if (!Number.isFinite(tdee) || tdee < 800 || tdee > 6000 || ratios.length !== 3 || ratios.some((value) => !Number.isFinite(value) || value <= 0)) {
    return null;
  }

  let displayName = parts.slice(1, parts.length - 2).join(" ").trim();
  if (!displayName) {
    const [profileSnap, lineProfile] = await Promise.all([
      db.collection("profiles").doc(canonicalUserId).get(),
      getLineProfile(lineUserId)
    ]);
    displayName = String(profileSnap.data()?.displayName ?? lineProfile.displayName ?? "Member");
  }

  const [proteinPct, carbsPct, fatPct] = ratios;
  return {
    displayName,
    target: {
      calories: Math.round(tdee),
      proteinPct,
      carbsPct,
      fatPct,
      proteinG: Math.round((tdee * proteinPct / 100) / 4),
      carbsG: Math.round((tdee * carbsPct / 100) / 4),
      fatG: Math.round((tdee * fatPct / 100) / 9),
      fiberG: 25
    }
  };
}

async function handleSubscriptionRequest(
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string,
  warningText = ""
): Promise<Record<string, unknown>> {
  const profile = await getUserProfile(canonicalUserId);
  const packageLines = SUBSCRIPTION_PACKAGES.map((plan) => `- ${plan.days} วัน = ${plan.priceThb} บาท`);
  const expireText = profile.expiresAt ? formatBangkokDate(profile.expiresAt.toDate()) : "-";
  const message = [
    warningText,
    `สมาชิก: ${profile.name}`,
    `หมดอายุ: ${expireText}`,
    "",
    "แพ็กเกจเติมวัน",
    ...packageLines,
    "",
    "โอนเงินแล้วส่งสลิปเข้าระบบเดิมก่อนนะครับ ระหว่างนี้ Firebase staging จะยังไม่รับสลิปจริงจนกว่า parity ครบ",
    `QR: ${PAYMENT_QR_IMAGE}`,
    "",
    `สำหรับแอดมิน staging: อนุมัติ ${lineUserId} 30`
  ].filter((line) => line !== "").join("\n");

  await db.collection("subscriptionRequests").add({
    canonicalUserId,
    lineUserId,
    displayName: profile.name,
    status: "payment-instructions-sent",
    packages: SUBSCRIPTION_PACKAGES,
    paymentQrImage: PAYMENT_QR_IMAGE,
    createdAt: Timestamp.now()
  });
  await replyToLine(replyToken, message);
  return { requested: true, packages: SUBSCRIPTION_PACKAGES.length };
}

async function handleRedeemCode(
  text: string,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown>> {
  const code = text.replace(/^(code|โค้ด|เติมโค้ด)\s*/i, "").trim();
  if (!code) {
    await replyToLine(replyToken, "กรุณาระบุโค้ด เช่น `code ABC123`");
    return { redeemed: false, reason: "missing-code" };
  }

  const codeRef = db.collection("redeemCodes").doc(code);
  let result: { ok: boolean; days: number; expiresAt: Timestamp | null; reason?: string } = {
    ok: false,
    days: 0,
    expiresAt: null
  };

  await db.runTransaction(async (transaction) => {
    const codeSnap = await transaction.get(codeRef);
    if (!codeSnap.exists) {
      result = { ok: false, days: 0, expiresAt: null, reason: "not-found" };
      return;
    }

    const codeData = codeSnap.data() ?? {};
    const status = String(codeData.status ?? "").toLowerCase();
    const days = Number(codeData.days ?? codeData.Days ?? 0);
    if (!days || days <= 0) {
      result = { ok: false, days: 0, expiresAt: null, reason: "invalid-days" };
      return;
    }
    if (status && status !== "available") {
      result = { ok: false, days, expiresAt: null, reason: "already-used" };
      return;
    }

    const newExpiry = subscriptionExpiryAfterDays(days, await getSubscriptionExpiryInTransaction(transaction, canonicalUserId));
    const now = Timestamp.now();
    transaction.set(db.collection("subscriptions").doc(canonicalUserId), {
      userId: canonicalUserId,
      canonicalUserId,
      status: "active",
      expiresAt: newExpiry,
      lastRedeemedCode: code,
      updatedAt: now
    }, { merge: true });
    transaction.set(db.collection("users").doc(canonicalUserId), {
      subscriptionStatus: "active",
      subscriptionExpiresAt: newExpiry,
      updatedAt: now
    }, { merge: true });
    transaction.set(db.collection("profiles").doc(canonicalUserId), {
      expiresAt: newExpiry,
      updatedAt: now
    }, { merge: true });
    transaction.update(codeRef, {
      status: "used",
      usedBy: canonicalUserId,
      usedLineUserId: lineUserId,
      usedDate: now,
      updatedAt: now
    });
    transaction.create(db.collection("subscriptionEvents").doc(), {
      type: "redeem-code",
      canonicalUserId,
      lineUserId,
      code,
      days,
      expiresAt: newExpiry,
      createdAt: now
    });
    result = { ok: true, days, expiresAt: newExpiry };
  });

  if (!result.ok) {
    await replyToLine(replyToken, `โค้ดนี้ใช้ไม่ได้ครับ (${result.reason ?? "unknown"})`);
    return { redeemed: false, reason: result.reason ?? "unknown" };
  }

  await replyToLine(replyToken, `เติมวันสำเร็จ (+${result.days} วัน)\nหมดอายุ: ${formatBangkokDate(result.expiresAt!.toDate())}`);
  return { redeemed: true, days: result.days, expiresAt: result.expiresAt!.toDate().toISOString() };
}

function parseAdminSubscriptionCommand(text: string): AdminSubscriptionCommand | null {
  const approve = text.match(/^(?:approve|อนุมัติ)\s+(\S+)(?:\s+(\d+))?/i);
  if (approve) {
    return {
      action: "approve",
      target: approve[1],
      days: Number(approve[2] ?? SUBSCRIPTION_PACKAGES[0].days)
    };
  }

  const reject = text.match(/^(?:reject|ปฏิเสธ|ไม่อนุมัติ)\s+(\S+)(?:\s+(.+))?/i);
  if (reject) {
    return {
      action: "reject",
      target: reject[1],
      reason: reject[2]?.trim() || null
    };
  }

  return null;
}

async function handleAdminSubscriptionCommand(
  command: AdminSubscriptionCommand,
  replyToken: string,
  adminLineUserId: string
): Promise<Record<string, unknown>> {
  const target = await resolveSubscriptionTarget(command.target);
  if (!target) {
    await replyToLine(replyToken, `ไม่พบลูกค้า: ${command.target}`);
    return { ok: false, reason: "target-not-found", target: command.target };
  }

  if (command.action === "reject") {
    const now = Timestamp.now();
    const pendingReview = await getLatestPendingPaymentReview(target.canonicalUserId);
    const reviewPayload = {
      status: "rejected",
      reason: command.reason,
      reviewedBy: adminLineUserId,
      reviewedAt: now,
      updatedAt: now
    };
    if (pendingReview) {
      await pendingReview.ref.set(reviewPayload, { merge: true });
    } else {
      await db.collection("paymentReviews").add({
        canonicalUserId: target.canonicalUserId,
        lineUserId: target.lineUserId,
        ...reviewPayload,
        createdAt: now
      });
    }
    await db.collection("subscriptionEvents").add({
      type: "admin-reject",
      canonicalUserId: target.canonicalUserId,
      lineUserId: target.lineUserId,
      reason: command.reason,
      adminLineUserId,
      createdAt: now
    });
    if (target.lineUserId) {
      await pushMessage(target.lineUserId, "สลิปของคุณยังไม่ผ่านการตรวจสอบครับ กรุณาติดต่อแอดมินหรือลองส่งใหม่อีกครั้ง");
    }
    await replyToLine(replyToken, `ปฏิเสธรายการของ ${target.canonicalUserId} แล้ว`);
    return { ok: true, canonicalUserId: target.canonicalUserId, action: "reject" };
  }

  if (!Number.isFinite(command.days) || command.days <= 0 || command.days > 3660) {
    await replyToLine(replyToken, "จำนวนวันไม่ถูกต้องครับ เช่น `อนุมัติ Uxxxxxxxx 30`");
    return { ok: false, reason: "invalid-days", days: command.days };
  }

  const currentExpiry = await getSubscriptionExpiry(target.canonicalUserId);
  const expiresAt = subscriptionExpiryAfterDays(command.days, currentExpiry);
  const now = Timestamp.now();
  const pendingReview = await getLatestPendingPaymentReview(target.canonicalUserId);
  await Promise.all([
    db.collection("subscriptions").doc(target.canonicalUserId).set({
      userId: target.canonicalUserId,
      canonicalUserId: target.canonicalUserId,
      status: "active",
      expiresAt,
      lastApprovedDays: command.days,
      lastApprovedBy: adminLineUserId,
      lastApprovedAt: now,
      updatedAt: now
    }, { merge: true }),
    db.collection("users").doc(target.canonicalUserId).set({
      subscriptionStatus: "active",
      subscriptionExpiresAt: expiresAt,
      updatedAt: now
    }, { merge: true }),
    db.collection("profiles").doc(target.canonicalUserId).set({
      expiresAt,
      updatedAt: now
    }, { merge: true }),
    pendingReview
      ? pendingReview.ref.set({
        status: "approved",
        days: command.days,
        expiresAt,
        reviewedBy: adminLineUserId,
        reviewedAt: now,
        updatedAt: now
      }, { merge: true })
      : db.collection("paymentReviews").add({
        canonicalUserId: target.canonicalUserId,
        lineUserId: target.lineUserId,
        status: "approved",
        days: command.days,
        expiresAt,
        reviewedBy: adminLineUserId,
        reviewedAt: now,
        createdAt: now
      }),
    db.collection("subscriptionEvents").add({
      type: "admin-approve",
      canonicalUserId: target.canonicalUserId,
      lineUserId: target.lineUserId,
      days: command.days,
      expiresAt,
      adminLineUserId,
      createdAt: now
    })
  ]);

  if (target.lineUserId) {
    await pushMessage(target.lineUserId, `ชำระเงินสำเร็จ ระบบต่ออายุให้ ${command.days} วัน\nหมดอายุ: ${formatBangkokDate(expiresAt.toDate())}`);
  }
  await replyToLine(replyToken, `อนุมัติ ${target.canonicalUserId} +${command.days} วัน\nหมดอายุ: ${formatBangkokDate(expiresAt.toDate())}`);
  return {
    ok: true,
    canonicalUserId: target.canonicalUserId,
    lineUserId: target.lineUserId,
    action: "approve",
    days: command.days,
    expiresAt: expiresAt.toDate().toISOString()
  };
}

async function resolveSubscriptionTarget(target: string): Promise<SubscriptionTarget | null> {
  const lineSnap = await db.collection("lineLinks").doc(target).get();
  if (lineSnap.exists) {
    return {
      canonicalUserId: String(lineSnap.data()?.canonicalUserId ?? target),
      lineUserId: target
    };
  }

  const [userSnap, profileSnap] = await Promise.all([
    db.collection("users").doc(target).get(),
    db.collection("profiles").doc(target).get()
  ]);
  if (!userSnap.exists && !profileSnap.exists) {
    return null;
  }

  const linkQuery = await db.collection("lineLinks")
    .where("canonicalUserId", "==", target)
    .limit(1)
    .get();
  return {
    canonicalUserId: target,
    lineUserId: linkQuery.empty ? null : linkQuery.docs[0].id
  };
}

async function getLatestPendingPaymentReview(canonicalUserId: string) {
  const snap = await db.collection("paymentReviews")
    .where("canonicalUserId", "==", canonicalUserId)
    .where("status", "==", "pending-admin-review")
    .orderBy("createdAt", "desc")
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function getSubscriptionExpiry(canonicalUserId: string): Promise<Timestamp | null> {
  const snap = await db.collection("subscriptions").doc(canonicalUserId).get();
  return snap.exists ? normalizeTimestamp(snap.data()?.expiresAt) : null;
}

async function getSubscriptionExpiryInTransaction(
  transaction: Transaction,
  canonicalUserId: string
): Promise<Timestamp | null> {
  const snap = await transaction.get(db.collection("subscriptions").doc(canonicalUserId));
  return snap.exists ? normalizeTimestamp(snap.data()?.expiresAt) : null;
}

function subscriptionExpiryAfterDays(days: number, currentExpiry: Timestamp | null): Timestamp {
  const nowMs = Date.now();
  const baseMs = currentExpiry && currentExpiry.toMillis() > nowMs ? currentExpiry.toMillis() : nowMs;
  return Timestamp.fromMillis(baseMs + days * 24 * 60 * 60 * 1000);
}

async function notifyAdminError(context: string, error: unknown): Promise<void> {
  const message = [
    "MyDietitian Firebase staging error",
    context,
    error instanceof Error ? error.message : String(error)
  ].join("\n");

  await db.collection("adminAuditLogs").add({
    type: "line-webhook-staging-error",
    context,
    error: error instanceof Error ? error.message : String(error),
    createdAt: Timestamp.now()
  });

  try {
    await pushMessage(ADMIN_LINE_USER_ID.value(), message);
  } catch {
    // Avoid cascading failures if admin push itself is unavailable.
  }
}

async function handleContactAdmin(
  text: string,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown>> {
  const message = text.replace(/^(ติดต่อ|แอดมิน|admin)/i, "").trim();
  if (!message) {
    await replyToLine(replyToken, "พิมพ์ข้อความต่อท้ายได้เลยครับ เช่น `ติดต่อ ขอเปลี่ยนวันเริ่ม`");
    return { forwarded: false, reason: "empty-contact-message" };
  }

  const profile = await getUserProfile(canonicalUserId);
  const adminMessage = [
    "ข้อความจากลูกค้า",
    `ชื่อ: ${profile.name}`,
    `LINE User ID: ${lineUserId}`,
    `Canonical ID: ${canonicalUserId}`,
    `ข้อความ: ${message}`,
    "",
    `ตอบกลับ: คุย ${lineUserId}`
  ].join("\n");

  await db.collection("adminContactRequests").add({
    canonicalUserId,
    lineUserId,
    displayName: profile.name,
    message,
    status: "forwarded",
    createdAt: Timestamp.now()
  });

  await pushMessage(ADMIN_LINE_USER_ID.value(), adminMessage);
  await replyToLine(replyToken, "ส่งข้อความถึงแอดมินเรียบร้อยครับ");
  return { forwarded: true };
}

async function forwardCustomerReplyIfAdminChatActive(
  text: string,
  lineUserId: string,
  canonicalUserId: string
): Promise<boolean> {
  const activeChat = await getActiveAdminChat(ADMIN_LINE_USER_ID.value());
  if (!activeChat || activeChat.targetLineUserId !== lineUserId) {
    return false;
  }

  const profile = await getUserProfile(canonicalUserId);
  await pushMessage(ADMIN_LINE_USER_ID.value(), `${profile.name} ตอบกลับ:\n${text}`);
  await db.collection("adminChatMessages").add({
    adminLineUserId: ADMIN_LINE_USER_ID.value(),
    targetLineUserId: lineUserId,
    canonicalUserId,
    direction: "customer-to-admin",
    text,
    createdAt: Timestamp.now()
  });
  return true;
}

async function getActiveAdminChat(adminLineUserId: string): Promise<{ targetLineUserId: string } | null> {
  const snap = await db.collection("adminChatSessions").doc(adminLineUserId).get();
  if (!snap.exists) return null;

  const data = snap.data() ?? {};
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  if (data.status !== "active" || expiresAt <= Date.now()) {
    return null;
  }

  return {
    targetLineUserId: String(data.targetLineUserId)
  };
}

async function getUserReadiness(userId: string): Promise<UserReadiness> {
  const [profileSnap, subscriptionSnap] = await Promise.all([
    db.collection("profiles").doc(userId).get(),
    db.collection("subscriptions").doc(userId).get()
  ]);
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const target = normalizeTarget(profile);
  const expiresAt = subscriptionSnap.exists ? normalizeTimestamp(subscriptionSnap.data()?.expiresAt) : normalizeTimestamp(profile.expiresAt);
  return {
    profileComplete: Boolean(profileSnap.exists && target.cal > 0 && target.p > 0 && target.c > 0 && target.f > 0),
    subscriptionActive: Boolean(expiresAt && expiresAt.toMillis() >= Date.now()),
    expiresAt
  };
}

async function getUserProfile(userId: string): Promise<UserProfile> {
  const [profileSnap, subscriptionSnap] = await Promise.all([
    db.collection("profiles").doc(userId).get(),
    db.collection("subscriptions").doc(userId).get()
  ]);
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const subscription = subscriptionSnap.exists ? subscriptionSnap.data() ?? {} : {};
  const target = normalizeTarget(profile);

  return {
    name: String(profile.displayName ?? profile.name ?? "Member"),
    target: {
      cal: target.cal || 2000,
      p: target.p || 100,
      c: target.c || 200,
      f: target.f || 60,
      fib: target.fib || 25
    },
    expiresAt: normalizeTimestamp(subscription.expiresAt ?? profile.expiresAt)
  };
}

async function getTodaySummary(userId: string, profile: UserProfile): Promise<TodaySummary> {
  const { startDate, endDate } = getBangkokDayRange(new Date());
  const [mealSnap, exerciseSnap] = await Promise.all([
    db.collection("mealLogs")
      .where("userId", "==", userId)
      .where("loggedAt", ">=", Timestamp.fromDate(startDate))
      .where("loggedAt", "<=", Timestamp.fromDate(endDate))
      .orderBy("loggedAt", "asc")
      .get(),
    db.collection("exerciseLogs")
      .where("userId", "==", userId)
      .where("loggedAt", ">=", Timestamp.fromDate(startDate))
      .where("loggedAt", "<=", Timestamp.fromDate(endDate))
      .orderBy("loggedAt", "asc")
      .get()
  ]);

  const consumed = { cal: 0, p: 0, c: 0, f: 0, fib: 0 };
  mealSnap.forEach((doc) => {
    const nutrients = doc.data().nutrients ?? {};
    consumed.cal += Number(nutrients.caloriesKcal ?? 0);
    consumed.p += Number(nutrients.proteinG ?? 0);
    consumed.c += Number(nutrients.carbsG ?? 0);
    consumed.f += Number(nutrients.fatG ?? 0);
    consumed.fib += Number(nutrients.fiberG ?? 0);
  });

  let burned = 0;
  exerciseSnap.forEach((doc) => {
    burned += Number(doc.data().caloriesBurned ?? 0);
  });

  const dynamicTarget = profile.target.cal + burned;
  return {
    consumed,
    burned,
    target: profile.target,
    dynamicTarget,
    remaining: {
      cal: dynamicTarget - consumed.cal,
      p: profile.target.p - consumed.p,
      c: profile.target.c - consumed.c,
      f: profile.target.f - consumed.f,
      fib: profile.target.fib - consumed.fib
    }
  };
}

function parseWeightCommand(text: string): { weightKg: number; bodyFatPct: number | null; muscleMassKg: number | null } | null {
  const weightMatch = text.match(/(?:หนัก|weight|น้ำหนัก)\s*(\d+(?:\.\d+)?)/i);
  if (!weightMatch) return null;

  const fatMatch = text.match(/(?:fat|ไขมัน|แฟต)\s*(\d+(?:\.\d+)?)/i);
  const muscleMatch = text.match(/(?:muscle|กล้าม|มวลกล้าม)\s*(\d+(?:\.\d+)?)/i);
  return {
    weightKg: Number(weightMatch[1]),
    bodyFatPct: fatMatch ? Number(fatMatch[1]) : null,
    muscleMassKg: muscleMatch ? Number(muscleMatch[1]) : null
  };
}

function looksLikeExerciseLog(text: string): boolean {
  const lower = text.toLowerCase();
  const hasExerciseKeyword =
    /วิ่ง|เดิน|เดินชัน|เวท|ยกน้ำหนัก|ปั่น|จักรยาน|ว่ายน้ำ|โยคะ|พิลาทิส|hiit|cardio|run|running|walk|walking|bike|cycling|swim|weight|workout|exercise/.test(lower);
  const hasMeasure =
    /\d+\s*(นาที|ชม|ชั่วโมง|hr|hrs|hour|hours|min|mins|minute|minutes|km|กม|กิโล|รอบ|sets?|reps?)/i.test(text);
  const asksQuestion = /ดีไหม|อะไรดี|แนะนำ|ควร|ไหม|\?/.test(text);
  return hasExerciseKeyword && hasMeasure && !asksQuestion;
}

function looksLikeMenuRecommendationRequest(text: string): boolean {
  const lower = text.toLowerCase();
  return /กินไรดี|กินอะไรดี|เมนู|แนะนำเมนู|แนะนำอาหาร|หิว|อะไรดี/.test(text) ||
    lower.includes("menu") ||
    lower.includes("recommend food") ||
    lower.includes("what should i eat");
}

function looksLikeCoachConsultationRequest(text: string): boolean {
  const lower = text.toLowerCase();
  if (looksLikeMenuRecommendationRequest(text)) return true;
  return /ดีไหม|ควร|ไหม|มั้ย|ได้ไหม|ได้มั้ย|ถาม|ปรึกษา|แนะนำ|ช่วยแนะนำ|ลดน้ำหนัก|เพิ่มกล้าม|คุมอาหาร|\?/.test(text) ||
    lower.includes("should i") ||
    lower.includes("advice") ||
    lower.includes("coach") ||
    lower.includes("recommend");
}

async function getRecentMealNames(userId: string, limit: number): Promise<string[]> {
  const snap = await db.collection("mealLogs")
    .where("userId", "==", userId)
    .orderBy("loggedAt", "desc")
    .limit(limit)
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    const mealName = String(data.mealNameTh ?? data.text ?? "meal");
    const calories = Math.round(Number(data.nutrients?.caloriesKcal ?? 0));
    return calories > 0 ? `${mealName} (${calories} kcal)` : mealName;
  });
}

function parsePortionAdjustment(text: string): { ratio: number; label: string } | null {
  const lower = text.toLowerCase();
  const hasAdjustmentVerb = /กิน|เหลือ|แค่|เอา|ปรับ|ลด|ทาน|ate|left|only|half|quarter|portion/.test(lower);
  if (!hasAdjustmentVerb) return null;

  const explicitFraction = lower.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (explicitFraction) {
    const numerator = Number(explicitFraction[1]);
    const denominator = Number(explicitFraction[2]);
    const ratio = denominator > 0 ? numerator / denominator : 0;
    return buildPortionAdjustment(ratio, `${explicitFraction[1]}/${explicitFraction[2]}`);
  }

  const explicitPercent = lower.match(/(\d+(?:\.\d+)?)\s*%/);
  if (explicitPercent) {
    const ratio = Number(explicitPercent[1]) / 100;
    return buildPortionAdjustment(ratio, `${explicitPercent[1]}%`);
  }

  const thaiNumberFraction = parseThaiNumberFraction(lower);
  if (thaiNumberFraction) {
    return thaiNumberFraction;
  }

  if (/ครึ่ง|half/.test(lower)) {
    return buildPortionAdjustment(0.5, "ครึ่งจาน");
  }
  if (/นิดเดียว|นิดหน่อย|a little|small portion/.test(lower)) {
    return buildPortionAdjustment(0.25, "นิดเดียว");
  }
  if (/third/.test(lower)) {
    return buildPortionAdjustment(1 / 3, "1/3");
  }
  if (/quarter/.test(lower)) {
    return buildPortionAdjustment(0.25, "1/4");
  }
  return null;
}

function parseThaiNumberFraction(lowerText: string): { ratio: number; label: string } | null {
  const thaiNumberWords: Record<string, number> = {
    หนึ่ง: 1,
    นึง: 1,
    สอง: 2,
    สาม: 3,
    สี่: 4,
    ห้า: 5,
    หก: 6,
    เจ็ด: 7,
    แปด: 8,
    เก้า: 9
  };
  const denominatorWords: Record<string, number> = {
    ส่วนสอง: 2,
    ส่วนสาม: 3,
    ส่วนสี่: 4,
    ส่วนห้า: 5,
    ส่วนหก: 6,
    ส่วนเจ็ด: 7,
    ส่วนแปด: 8,
    ส่วนเก้า: 9
  };

  for (const [denominatorWord, denominator] of Object.entries(denominatorWords)) {
    const numeratorPattern = new RegExp(`(${Object.keys(thaiNumberWords).join("|")})\\s*${denominatorWord}`);
    const match = lowerText.match(numeratorPattern);
    if (match?.[1]) {
      return buildPortionAdjustment(thaiNumberWords[match[1]] / denominator, `${match[1]}${denominatorWord}`);
    }
  }

  return null;
}

function buildPortionAdjustment(ratio: number, rawLabel: string): { ratio: number; label: string } | null {
  if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) return null;
  const normalizedRatio = Number(ratio.toFixed(4));
  const percent = Math.round(normalizedRatio * 100);
  return {
    ratio: normalizedRatio,
    label: `${percent}% (${rawLabel})`
  };
}

function parseMealCorrectionText(text: string): string | null {
  const trimmed = text.trim();
  const patterns = [
    /(?:ไม่ใช่|ผิด|แก้เป็น|เปลี่ยนเป็น|จริงๆ|จริง ๆ)\s*(.+)$/i,
    /(?:not|wrong|actually|change to|correct to|it is)\s+(.+)$/i
  ];

  const explicitReplace = trimmed.match(/(?:ไม่ใช่|ผิด).{0,30}?(?:เป็น|คือ)\s*(.+)$/i);
  if (explicitReplace?.[1]) return sanitizeCorrectionFoodText(explicitReplace[1]);

  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return sanitizeCorrectionFoodText(match[1]);
  }

  return null;
}

function sanitizeCorrectionFoodText(text: string): string | null {
  const cleaned = text
    .replace(/^[:：\-–—\s]+/, "")
    .replace(/^(อาหาร|เมนู|จาน)\s*/, "")
    .trim();
  if (!cleaned || cleaned.length < 2) return null;
  if (/^(ครับ|ค่ะ|คับ|จ้า|นะ)$/.test(cleaned)) return null;
  return cleaned;
}

async function getLatestMealLog(userId: string) {
  const snap = await db.collection("mealLogs")
    .where("userId", "==", userId)
    .orderBy("loggedAt", "desc")
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0];
}

async function adjustLatestMealPortion(
  userId: string,
  adjustment: { ratio: number; label: string },
  commandText: string
): Promise<{ adjusted: boolean; message: string }> {
  const doc = await getLatestMealLog(userId);
  if (!doc) {
    return { adjusted: false, message: "ไม่พบรายการอาหารล่าสุดให้ปรับปริมาณครับ" };
  }

  const data = doc.data();
  const nutrients = data.nutrients ?? {};
  const previousAdjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
  const baseNutrients = previousAdjustments[0]?.previousNutrients ?? nutrients;
  const scaledNutrients = {
    caloriesKcal: Math.round(Number(baseNutrients.caloriesKcal ?? 0) * adjustment.ratio),
    proteinG: Math.round(Number(baseNutrients.proteinG ?? 0) * adjustment.ratio),
    carbsG: Math.round(Number(baseNutrients.carbsG ?? 0) * adjustment.ratio),
    fatG: Math.round(Number(baseNutrients.fatG ?? 0) * adjustment.ratio),
    fiberG: Number((Number(baseNutrients.fiberG ?? 0) * adjustment.ratio).toFixed(1)),
    sugarG: Number((Number(baseNutrients.sugarG ?? 0) * adjustment.ratio).toFixed(1))
  };
  const originalName = String(data.mealNameTh ?? data.mealNameEn ?? "รายการอาหาร");

  await doc.ref.set(
    {
      mealNameTh: `${originalName.replace(/\s*\([^)]*\)\s*$/, "")} (${adjustment.label})`,
      nutrients: scaledNutrients,
      adjustments: [
        ...previousAdjustments,
        {
          type: "portion-ratio",
          ratio: adjustment.ratio,
          label: adjustment.label,
          commandText,
          previousNutrients: baseNutrients,
          adjustedAt: Timestamp.now()
        }
      ],
      updatedAt: Timestamp.now()
    },
    { merge: true }
  );

  return {
    adjusted: true,
    message: [
      "ปรับปริมาณรายการล่าสุดเรียบร้อยครับ",
      `เมนู: ${originalName}`,
      `กินจริง: ${adjustment.label}`,
      `เหลือ: ${scaledNutrients.caloriesKcal} kcal`,
      `(P:${scaledNutrients.proteinG} C:${scaledNutrients.carbsG} F:${scaledNutrients.fatG} Fib:${scaledNutrients.fiberG})`
    ].join("\n")
  };
}

async function subtractLatestMealLeftover(input: {
  canonicalUserId: string;
  lineUserId: string;
  messageId: string;
  imageBase64: string;
  mimeType: string;
}): Promise<{ subtracted: boolean; message: string; mealLogId?: string; aiRunId?: string }> {
  const doc = await getLatestMealLog(input.canonicalUserId);
  if (!doc) {
    return { subtracted: false, message: "ไม่พบรายการอาหารล่าสุดให้หักของเหลือครับ" };
  }

  const data = doc.data();
  const latestMealName = String(data.mealNameTh ?? data.mealNameEn ?? "รายการอาหารล่าสุด");
  const agent = await getAiAgentConfig("mealAnalysis");
  if (!agent.enabled) {
    throw new Error("AI mealAnalysis agent is disabled");
  }
  if (agent.provider !== "gemini") {
    throw new Error(`Unsupported mealAnalysis provider for leftover analysis: ${agent.provider}`);
  }

  const aiRunRef = db.collection("aiRuns").doc();
  const now = Timestamp.now();
  await aiRunRef.set({
    runId: aiRunRef.id,
    userId: input.canonicalUserId,
    canonicalUserId: input.canonicalUserId,
    lineUserId: input.lineUserId,
    source: "line",
    inputType: "leftover_image",
    imageUrl: `line-message://${input.messageId}`,
    status: "running",
    createdAt: now,
    agentId: agent.agentId,
    provider: agent.provider,
    promptVersion: agent.promptVersion,
    model: agent.model
  });

  try {
    const leftover = await callGeminiLeftoverAnalysis(
      {
        imageBase64: input.imageBase64,
        mimeType: input.mimeType,
        latestMealName
      },
      GEMINI_API_KEY.value(),
      agent
    );
    const nutrients = data.nutrients ?? {};
    const leftoverNutrients = {
      caloriesKcal: Math.max(0, Math.round(Number(leftover.nutrients?.calories_kcal ?? 0))),
      proteinG: Math.max(0, Math.round(Number(leftover.nutrients?.protein_g ?? 0))),
      carbsG: Math.max(0, Math.round(Number(leftover.nutrients?.carbs_g ?? 0))),
      fatG: Math.max(0, Math.round(Number(leftover.nutrients?.fat_g ?? 0))),
      fiberG: Math.max(0, Number(Number(leftover.nutrients?.fiber_g ?? 0).toFixed(1))),
      sugarG: Math.max(0, Number(Number(leftover.nutrients?.sugar_g ?? 0).toFixed(1)))
    };
    const updatedNutrients = {
      caloriesKcal: Math.max(0, Math.round(Number(nutrients.caloriesKcal ?? 0) - leftoverNutrients.caloriesKcal)),
      proteinG: Math.max(0, Math.round(Number(nutrients.proteinG ?? 0) - leftoverNutrients.proteinG)),
      carbsG: Math.max(0, Math.round(Number(nutrients.carbsG ?? 0) - leftoverNutrients.carbsG)),
      fatG: Math.max(0, Math.round(Number(nutrients.fatG ?? 0) - leftoverNutrients.fatG)),
      fiberG: Math.max(0, Number((Number(nutrients.fiberG ?? 0) - leftoverNutrients.fiberG).toFixed(1))),
      sugarG: Math.max(0, Number((Number(nutrients.sugarG ?? 0) - leftoverNutrients.sugarG).toFixed(1)))
    };
    const previousAdjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
    const savedAt = Timestamp.now();
    const leftoverName = leftover.dish_name?.th ?? "ของเหลือ";

    await doc.ref.set(
      {
        mealNameTh: `${latestMealName.replace(/\s*\([^)]*\)\s*$/, "")} (หัก: ${leftoverName})`,
        nutrients: updatedNutrients,
        adjustments: [
          ...previousAdjustments,
          {
            type: "leftover-subtraction",
            lineMessageId: input.messageId,
            leftoverNameTh: leftoverName,
            portionDescription: leftover.portion_description ?? "",
            subtractedNutrients: leftoverNutrients,
            previousNutrients: nutrients,
            aiRunId: aiRunRef.id,
            adjustedAt: savedAt
          }
        ],
        updatedAt: savedAt
      },
      { merge: true }
    );
    await aiRunRef.set(
      {
        status: "completed",
        mealLogId: doc.id,
        completedAt: savedAt,
        output: leftover
      },
      { merge: true }
    );

    return {
      subtracted: true,
      mealLogId: doc.id,
      aiRunId: aiRunRef.id,
      message: formatLeftoverSubtractionReply(latestMealName, leftoverName, leftoverNutrients, updatedNutrients)
    };
  } catch (error) {
    await aiRunRef.set(
      {
        status: "failed",
        failedAt: Timestamp.now(),
        error: error instanceof Error ? error.message : String(error)
      },
      { merge: true }
    );
    throw error;
  }
}

async function replaceLatestMealWithCorrection(
  userId: string,
  correctedText: string,
  originalCommandText: string
): Promise<{ corrected: boolean; message: string; runId?: string; mealLogId?: string }> {
  const latest = await getLatestMealLog(userId);
  if (!latest) {
    return { corrected: false, message: "ไม่พบรายการอาหารล่าสุดให้แก้ไขครับ" };
  }

  const previousData = latest.data();
  const saved = await analyzeAndSaveMeal({
    userId,
    canonicalUserId: userId,
    source: "line",
    inputType: "text",
    text: correctedText
  });
  const now = Timestamp.now();
  await db.collection("mealLogs").doc(saved.mealLogId).set(
    {
      correction: {
        type: "replace-latest",
        originalMealLogId: latest.id,
        originalMealNameTh: previousData.mealNameTh ?? null,
        originalMealNameEn: previousData.mealNameEn ?? null,
        originalCommandText,
        correctedText,
        correctedAt: now
      },
      updatedAt: now
    },
    { merge: true }
  );
  await latest.ref.delete();

  const correctedMeal = saved.mealLog;
  const nutrients = correctedMeal.nutrients as Record<string, unknown> | undefined;
  return {
    corrected: true,
    runId: saved.runId,
    mealLogId: saved.mealLogId,
    message: [
      "แก้ไขรายการล่าสุดเรียบร้อยครับ",
      `จาก: ${previousData.mealNameTh ?? previousData.mealNameEn ?? "รายการเดิม"}`,
      `เป็น: ${correctedMeal.mealNameTh ?? correctedText}`,
      `พลังงานใหม่: ${Math.round(Number(nutrients?.caloriesKcal ?? 0))} kcal`,
      `(P:${Math.round(Number(nutrients?.proteinG ?? 0))} C:${Math.round(Number(nutrients?.carbsG ?? 0))} F:${Math.round(Number(nutrients?.fatG ?? 0))})`
    ].join("\n")
  };
}

async function saveWeightLog(
  userId: string,
  weight: { weightKg: number; bodyFatPct: number | null; muscleMassKg: number | null }
): Promise<void> {
  const now = Timestamp.now();
  await db.collection("weightLogs").add({
    userId,
    canonicalUserId: userId,
    source: "line",
    weightKg: weight.weightKg,
    bodyFatPct: weight.bodyFatPct,
    muscleMassKg: weight.muscleMassKg,
    deviceName: "Manual Chat",
    loggedAt: now,
    createdAt: now,
    updatedAt: now
  });

  await db.collection("profiles").doc(userId).set(
    {
      userId,
      canonicalUserId: userId,
      weightKg: weight.weightKg,
      updatedAt: now
    },
    { merge: true }
  );
}

async function deleteLastMealLog(userId: string): Promise<{ deleted: boolean; message: string }> {
  const snap = await db.collection("mealLogs")
    .where("userId", "==", userId)
    .orderBy("loggedAt", "desc")
    .limit(1)
    .get();

  if (snap.empty) {
    return { deleted: false, message: "ไม่พบรายการอาหารของคุณในประวัติครับ" };
  }

  const doc = snap.docs[0];
  const data = doc.data();
  await doc.ref.delete();
  return {
    deleted: true,
    message: `ลบรายการล่าสุด: ${data.mealNameTh ?? data.mealNameEn ?? "รายการอาหาร"} เรียบร้อย`
  };
}

function formatProfileReply(profile: UserProfile): string {
  const expireText = profile.expiresAt ? formatBangkokDate(profile.expiresAt.toDate()) : "-";
  return [
    `ข้อมูลส่วนตัว (${profile.name})`,
    `หมดอายุ: ${expireText}`,
    `TDEE: ${Math.round(profile.target.cal)} kcal`,
    `P:${Math.round(profile.target.p)} C:${Math.round(profile.target.c)} F:${Math.round(profile.target.f)} Fib:${Math.round(profile.target.fib)}`
  ].join("\n");
}

function formatDailySummaryReply(profile: UserProfile, summary: TodaySummary): string {
  return [
    `สรุปยอดวันนี้ (${profile.name})`,
    `เป้าหมาย: ${Math.round(summary.dynamicTarget)} kcal`,
    `กินแล้ว: ${Math.round(summary.consumed.cal)} kcal`,
    `(P:${Math.round(summary.consumed.p)} C:${Math.round(summary.consumed.c)} F:${Math.round(summary.consumed.f)} Fib:${summary.consumed.fib.toFixed(1)})`,
    `คงเหลือ:`,
    `Cal: ${Math.round(summary.remaining.cal)} kcal`,
    `P:${Math.round(summary.remaining.p)}g | C:${Math.round(summary.remaining.c)}g`,
    `F:${Math.round(summary.remaining.f)}g | Fib:${summary.remaining.fib.toFixed(1)}g`
  ].join("\n");
}

function formatWeightReply(weight: { weightKg: number; bodyFatPct: number | null; muscleMassKg: number | null }): string {
  const lines = [
    "บันทึกข้อมูลเรียบร้อย",
    `น้ำหนัก: ${weight.weightKg} kg`
  ];
  if (weight.bodyFatPct !== null) lines.push(`ไขมัน: ${weight.bodyFatPct}%`);
  if (weight.muscleMassKg !== null) lines.push(`กล้ามเนื้อ: ${weight.muscleMassKg} kg`);
  return lines.join("\n");
}

function formatExerciseGuideReply(): string {
  return [
    "บันทึกการออกกำลังกาย",
    "พิมพ์บอกโค้ชได้เลยครับว่าทำอะไรไปบ้าง เช่น",
    "วิ่ง 30 นาที",
    "เดินชัน 15% ความเร็ว 4.5 นาน 45 นาที",
    "เวทเทรนนิ่ง 1 ชั่วโมง",
    "โค้ชจะคำนวณแคลอรี่ที่เบิร์นได้และปรับโควต้าการกินให้ครับ"
  ].join("\n");
}

function formatExerciseReply(exerciseLog: Record<string, unknown>, summary: TodaySummary): string {
  return [
    "บันทึกการเบิร์นเรียบร้อย",
    `กิจกรรม: ${exerciseLog.activityName}`,
    `เบิร์นจริง: ${Math.round(Number(exerciseLog.rawCaloriesBurned ?? 0))} kcal`,
    `ได้กินเพิ่ม: +${Math.round(Number(exerciseLog.caloriesBurned ?? 0))} kcal (50%)`,
    "------------------",
    `เป้าหมายใหม่: ${Math.round(summary.dynamicTarget)} kcal`,
    `กินได้อีก: ${Math.round(summary.remaining.cal)} kcal`,
    String(exerciseLog.commentTh ?? "")
  ].join("\n");
}

function formatCoachConsultationReply(answer: string, mode: CoachConsultationRequest["mode"]): string {
  const title = mode === "menu_recommendation" ? "คำแนะนำเมนูวันนี้" : "คำแนะนำจากโค้ช";
  return [
    title,
    "------------------",
    answer
  ].join("\n");
}

function formatLeftoverSubtractionReply(
  mealName: string,
  leftoverName: string,
  leftoverNutrients: Record<string, number>,
  updatedNutrients: Record<string, number>
): string {
  return [
    "หักลบของเหลือเรียบร้อยครับ",
    `จากเมนู: ${mealName}`,
    `หักออก: ${leftoverName}`,
    `-${Math.round(leftoverNutrients.caloriesKcal ?? 0)} kcal`,
    `(P:-${Math.round(leftoverNutrients.proteinG ?? 0)} C:-${Math.round(leftoverNutrients.carbsG ?? 0)} F:-${Math.round(leftoverNutrients.fatG ?? 0)} Fib:-${Number(leftoverNutrients.fiberG ?? 0).toFixed(1)})`,
    "------------------",
    "รายการล่าสุดหลังหัก:",
    `${Math.round(updatedNutrients.caloriesKcal ?? 0)} kcal`,
    `(P:${Math.round(updatedNutrients.proteinG ?? 0)} C:${Math.round(updatedNutrients.carbsG ?? 0)} F:${Math.round(updatedNutrients.fatG ?? 0)} Fib:${Number(updatedNutrients.fiberG ?? 0).toFixed(1)})`
  ].join("\n");
}

function formatBiaAnalysisReply(
  biaReportId: string,
  profile: UserProfile,
  analysis: Awaited<ReturnType<typeof analyzeBiaReport>>
): string {
  const metrics = analysis.metrics ?? {};
  const rec = analysis.recommendation ?? {};
  const suggestedTdee = Math.round(Number(rec.suggested_tdee ?? profile.target.cal));
  const suggestedP = Math.round(Number(rec.suggested_p ?? profile.target.p));
  const suggestedC = Math.round(Number(rec.suggested_c ?? profile.target.c));
  const suggestedF = Math.round(Number(rec.suggested_f ?? profile.target.f));

  return [
    "วิเคราะห์รายงาน BIA/สุขภาพเรียบร้อย",
    `รหัสรายการ: ${biaReportId}`,
    "",
    `น้ำหนัก: ${formatOptionalNumber(metrics.weight_kg)} kg`,
    `Fat: ${formatOptionalNumber(metrics.fat_pct)}% | Muscle: ${formatOptionalNumber(metrics.muscle_kg)} kg`,
    `BMR: ${formatOptionalNumber(metrics.bmr)} kcal | Visceral: ${formatOptionalNumber(metrics.visceral_lvl)}`,
    "",
    `คำแนะนำ: ${rec.goal_name ?? "ปรับเป้าหมายแบบ conservative"}`,
    `TDEE เดิม: ${Math.round(profile.target.cal)} -> ใหม่: ${suggestedTdee} kcal`,
    `P:${suggestedP}g C:${suggestedC}g F:${suggestedF}g`,
    String(rec.reason_th ?? ""),
    String(analysis.workout_advice_th ?? ""),
    "",
    "ถ้าต้องการใช้เป้าใหม่ ให้ส่งคำสั่งนี้:",
    `CONFIRM_UPDATE_TARGET ${suggestedTdee} ${suggestedP}-${suggestedC}-${suggestedF}`,
    "ถ้าไม่ปรับ ส่ง: ไม่ปรับเป้าหมาย"
  ].filter((line) => line !== "").join("\n");
}

function formatOptionalNumber(value: unknown): string {
  const number = Number(value ?? 0);
  return number ? String(Math.round(number * 10) / 10) : "-";
}

async function replyWithOnboarding(replyToken: string, lineUserId: string, displayName = "Member"): Promise<void> {
  await replyToLineMessages(replyToken, buildOnboardingMessages(lineUserId, displayName));
}

function buildOnboardingMessages(lineUserId: string, displayName = "Member"): LineMessage[] {
  const liffUrl = `${LIFF_SETTINGS_URL}&uid=${encodeURIComponent(lineUserId)}`;
  return [{
    type: "flex",
    altText: "ตั้งค่าโปรไฟล์ MyDietitian",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#EAF7EF",
        contents: [
          { type: "text", text: "Welcome to MyDietitian", weight: "bold", color: "#1B7F4C", size: "sm" },
          { type: "text", text: `สวัสดีครับคุณ ${displayName}`, weight: "bold", size: "xl", margin: "sm", wrap: true }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          {
            type: "text",
            text: "ก่อนให้ AI coach ประเมินอาหารและออกกำลังกาย ต้องตั้งค่าเป้าหมายโภชนาการก่อนครับ",
            wrap: true,
            size: "sm",
            color: "#334155"
          },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F8FAFC",
            cornerRadius: "md",
            paddingAll: "12px",
            contents: [
              { type: "text", text: "ตั้งค่าเร็วในแชท", weight: "bold", size: "sm", color: "#0F172A" },
              { type: "text", text: "ตั้งค่า ชื่อ 2000 40-30-30", size: "sm", color: "#475569", margin: "xs", wrap: true }
            ]
          },
          {
            type: "text",
            text: "หลังตั้งค่าใหม่ ระบบ staging จะให้ trial 3 วันเพื่อทดสอบ flow ก่อน production cutover",
            wrap: true,
            size: "xs",
            color: "#64748B"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1DB446",
            action: { type: "uri", label: "เปิดฟอร์มตั้งค่า", uri: liffUrl }
          },
          {
            type: "button",
            style: "secondary",
            action: { type: "message", label: "ใช้ตัวอย่างตั้งค่า", text: "ตั้งค่า 2000 40-30-30" }
          },
          {
            type: "text",
            text: "Production LINE OA เดิมยังใช้งานตามปกติ",
            align: "center",
            size: "xxs",
            color: "#94A3B8",
            wrap: true
          }
        ]
      }
    }
  }];
}

function formatDashboardReply(lineUserId: string): string {
  const dashboardLink = `${LEGACY_GAS_DASHBOARD_URL}?uid=${encodeURIComponent(lineUserId)}`;
  return [
    "Dashboard",
    "ระหว่าง Firebase staging ยังไม่ได้ migrate data ระบบจะเปิด dashboard เดิมก่อนครับ",
    dashboardLink
  ].join("\n");
}

function formatHelpReply(): string {
  return [
    "คู่มือใช้งานแบบย่อ",
    "บันทึกอาหาร: พิมพ์ชื่ออาหาร หรือส่งรูปหลังเปิด image parity",
    "สรุปวันนี้: พิมพ์ `สรุป` หรือ `ยอด`",
    "จดน้ำหนัก: `หนัก 65 fat 20 muscle 28`",
    "ลบรายการล่าสุด: `ลบ` หรือ `undo`",
    "Dashboard: พิมพ์ `กราฟ` หรือ `dashboard`"
  ].join("\n");
}

function getBangkokDayRange(date: Date): { startDate: Date; endDate: Date } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const startDate = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
  const endDate = new Date(startDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { startDate, endDate };
}

function formatBangkokDate(date: Date): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatBangkokIsoDayKey(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

function normalizeTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  }
  return null;
}

function timestampToIso(value: unknown): string | null {
  const timestamp = normalizeTimestamp(value);
  return timestamp ? timestamp.toDate().toISOString() : null;
}

function getPreviousDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, -7, 0, 0, 0));
  date.setUTCDate(date.getUTCDate() - 1);
  return formatBangkokIsoDayKey(date);
}

function normalizeStreak(source: Record<string, unknown>) {
  const streak = (source.streak ?? {}) as Record<string, unknown>;
  return {
    count: Math.max(0, Number(streak.count ?? 0)),
    lastMealLogDayKey: typeof streak.lastMealLogDayKey === "string" ? streak.lastMealLogDayKey : null,
    updatedAt: timestampToIso(streak.updatedAt)
  };
}

function formatMealReply(mealLog: Record<string, unknown>): string {
  const nutrients = mealLog.nutrients as Record<string, number>;
  const rating = mealLog.healthRating as Record<string, string | number>;
  const streak = normalizeStreak(mealLog);
  const streakText = streak.count > 1
    ? `Streak: บันทึกอาหารต่อเนื่อง ${streak.count} วัน`
    : "Streak: เริ่มบันทึกวันแรก";

  return [
    `บันทึกอาหารแล้ว: ${mealLog.mealNameTh}`,
    `พลังงานประมาณ ${Math.round(nutrients.caloriesKcal ?? 0)} kcal`,
    `P ${Math.round(nutrients.proteinG ?? 0)}g | C ${Math.round(nutrients.carbsG ?? 0)}g | F ${Math.round(nutrients.fatG ?? 0)}g | Fiber ${Math.round(nutrients.fiberG ?? 0)}g`,
    `คะแนน: ${rating.score}/10`,
    String(rating.commentTh ?? ""),
    streakText
  ].join("\n");
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

async function listMealHistoryItems(userId: string, startDate: Date, endDate: Date) {
  const snap = await db.collection("mealLogs")
    .where("userId", "==", userId)
    .where("loggedAt", ">=", Timestamp.fromDate(startDate))
    .where("loggedAt", "<=", Timestamp.fromDate(endDate))
    .orderBy("loggedAt", "desc")
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    const nutrients = data.nutrients ?? {};
    const loggedAt = normalizeTimestamp(data.loggedAt);
    const adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
    return {
      id: doc.id,
      date: loggedAt ? formatDayKey(loggedAt.toDate()) : null,
      loggedAt: loggedAt ? loggedAt.toDate().toISOString() : null,
      source: data.source ?? null,
      inputType: data.inputType ?? null,
      text: data.text ?? null,
      imageUrl: data.imageUrl ?? null,
      mealNameTh: data.mealNameTh ?? null,
      mealNameEn: data.mealNameEn ?? null,
      portionDescription: data.portionDescription ?? null,
      nutrients: {
        caloriesKcal: Number(nutrients.caloriesKcal ?? 0),
        proteinG: Number(nutrients.proteinG ?? 0),
        carbsG: Number(nutrients.carbsG ?? 0),
        fatG: Number(nutrients.fatG ?? 0),
        fiberG: Number(nutrients.fiberG ?? 0),
        sugarG: Number(nutrients.sugarG ?? 0)
      },
      healthRating: data.healthRating ?? null,
      correction: data.correction ?? null,
      adjustments: adjustments.map((adjustment: Record<string, unknown>, index: number) => ({
        ...adjustment,
        mealLogId: doc.id,
        adjustmentIndex: index,
        adjustedAt: timestampToIso(adjustment.adjustedAt)
      })),
      ai: data.ai ?? null
    };
  });
}

async function listExerciseHistoryItems(userId: string, startDate: Date, endDate: Date) {
  const snap = await db.collection("exerciseLogs")
    .where("userId", "==", userId)
    .where("loggedAt", ">=", Timestamp.fromDate(startDate))
    .where("loggedAt", "<=", Timestamp.fromDate(endDate))
    .orderBy("loggedAt", "desc")
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    const loggedAt = normalizeTimestamp(data.loggedAt);
    return {
      id: doc.id,
      date: loggedAt ? formatDayKey(loggedAt.toDate()) : null,
      loggedAt: loggedAt ? loggedAt.toDate().toISOString() : null,
      source: data.source ?? null,
      text: data.text ?? null,
      activityName: data.activityName ?? null,
      rawCaloriesBurned: Number(data.rawCaloriesBurned ?? 0),
      caloriesBurned: Number(data.caloriesBurned ?? 0),
      safetyFactor: Number(data.safetyFactor ?? 0),
      commentTh: data.commentTh ?? null,
      ai: data.ai ?? null
    };
  });
}

async function listWeightHistoryItems(userId: string, startDate: Date, endDate: Date) {
  const snap = await db.collection("weightLogs")
    .where("userId", "==", userId)
    .where("loggedAt", ">=", Timestamp.fromDate(startDate))
    .where("loggedAt", "<=", Timestamp.fromDate(endDate))
    .orderBy("loggedAt", "desc")
    .get();

  return snap.docs.map((doc) => {
    const data = doc.data();
    const loggedAt = normalizeTimestamp(data.loggedAt);
    return {
      id: doc.id,
      date: loggedAt ? formatDayKey(loggedAt.toDate()) : null,
      loggedAt: loggedAt ? loggedAt.toDate().toISOString() : null,
      source: data.source ?? null,
      weightKg: Number(data.weightKg ?? 0) || null,
      bodyFatPct: Number(data.bodyFatPct ?? 0) || null,
      muscleMassKg: Number(data.muscleMassKg ?? 0) || null,
      deviceName: data.deviceName ?? null
    };
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
