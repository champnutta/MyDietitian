import { onRequest } from "firebase-functions/v2/https";
import { Timestamp, type Transaction } from "firebase-admin/firestore";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  callGeminiExerciseAnalysis,
  callGeminiMealAnalysis,
  getAiAgentConfig
} from "./ai-provider.js";
import type {
  AnalyzeExerciseRequest,
  AnalyzeMealRequest,
  DashboardDataRequest,
  LineWebhookEvent,
  UpdateProfileRequest
} from "./contracts.js";
import { resolveCanonicalUserId, resolveLineCanonicalUserId } from "./identity-service.js";
import {
  downloadLineContent,
  pushMessage,
  replyToLine,
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

  response.json({
    ok: true,
    canonicalUserId,
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

    return { runId: aiRunRef.id, mealLogId: mealLogRef.id, mealLog };
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
    await replyToLine(replyToken, "ยินดีต้อนรับครับ ตอนนี้ระบบ Firebase ยังอยู่ในโหมดทดสอบ กรุณาใช้งานผ่าน LINE OA เดิมต่อไปก่อนครับ");
    return { ok: true, type: event.type, status: "follow-replied" };
  }

  if (event.type !== "message") {
    return { ok: true, type: event.type, status: "ignored" };
  }

  if (event.message?.type === "image") {
    const canonicalUserId = await resolveLineCanonicalUserId(lineUserId);
    return handleLineImageMessage(event, replyToken, canonicalUserId, lineUserId);
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
  lineUserId: string
): Promise<Record<string, unknown>> {
  const messageId = event.message?.id;
  if (!messageId) {
    await replyToLine(replyToken, "ไม่พบรหัสรูปภาพจาก LINE ครับ กรุณาส่งรูปอาหารอีกครั้ง");
    return { ok: false, type: event.type, status: "missing-image-message-id" };
  }

  await showLoadingAnimation(lineUserId, 20);

  try {
    const content = await downloadLineContent(messageId);
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
      mimeType: content.mimeType
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

  if (isSubscriptionRequestCommand(text)) {
    const result = await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId);
    return { status: "subscription-request-replied", ...result };
  }

  if (isRedeemCodeCommand(text)) {
    const result = await handleRedeemCode(text, replyToken, canonicalUserId, lineUserId);
    return { status: "redeem-code-processed", ...result };
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

  if (looksLikeExerciseLog(text)) {
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

async function handleSubscriptionRequest(
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown>> {
  const profile = await getUserProfile(canonicalUserId);
  const packageLines = SUBSCRIPTION_PACKAGES.map((plan) => `- ${plan.days} วัน = ${plan.priceThb} บาท`);
  const expireText = profile.expiresAt ? formatBangkokDate(profile.expiresAt.toDate()) : "-";
  const message = [
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
  ].join("\n");

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
    await db.collection("paymentReviews").add({
      canonicalUserId: target.canonicalUserId,
      lineUserId: target.lineUserId,
      status: "rejected",
      reason: command.reason,
      reviewedBy: adminLineUserId,
      reviewedAt: now,
      createdAt: now
    });
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
    db.collection("paymentReviews").add({
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

function normalizeTimestamp(value: unknown): Timestamp | null {
  if (value instanceof Timestamp) return value;
  if (value instanceof Date) return Timestamp.fromDate(value);
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return Timestamp.fromDate(date);
  }
  return null;
}

function formatMealReply(mealLog: Record<string, unknown>): string {
  const nutrients = mealLog.nutrients as Record<string, number>;
  const rating = mealLog.healthRating as Record<string, string | number>;

  return [
    `บันทึกอาหารแล้ว: ${mealLog.mealNameTh}`,
    `พลังงานประมาณ ${Math.round(nutrients.caloriesKcal ?? 0)} kcal`,
    `P ${Math.round(nutrients.proteinG ?? 0)}g | C ${Math.round(nutrients.carbsG ?? 0)}g | F ${Math.round(nutrients.fatG ?? 0)}g | Fiber ${Math.round(nutrients.fiberG ?? 0)}g`,
    `คะแนน: ${rating.score}/10`,
    String(rating.commentTh ?? "")
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
