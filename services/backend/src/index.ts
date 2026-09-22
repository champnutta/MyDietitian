import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { FieldValue, Timestamp, type DocumentSnapshot, type Transaction } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
  callGeminiBiaAnalysis,
  callGeminiCoachConsultation,
  callGeminiExerciseAnalysis,
  callGeminiImageClassification,
  callGeminiLeftoverAnalysis,
  callGeminiMealAnalysis,
  getAiAgentConfig,
  MealImageUnclearError
} from "./ai-provider.js";
import type {
  AnalyzeExerciseRequest,
  AnalyzeMealRequest,
  CancelWeeklyProgramRequest,
  CoachConsultationRequest,
  ConfirmLeftoverFromLiffRequest,
  DashboardDataRequest,
  DeleteExerciseFromLiffRequest,
  DeleteMealFromLiffRequest,
  GetExerciseForLiffRequest,
  GetMealForLiffRequest,
  LinkLineAccountRequest,
  LineWebhookEvent,
  PreviewLeftoverFromLiffRequest,
  ProgramMacro,
  SaveMealEditFromLiffRequest,
  SaveSettingsFromWebRequest,
  SaveWeeklyProgramRequest,
  UpdateProfileRequest,
  WeeklyProgram
} from "./contracts.js";
import { resolveCanonicalUserId, resolveLineCanonicalUserId } from "./identity-service.js";
import {
  downloadLineContent,
  getLineProfile,
  type LineMessage,
  pushMessage,
  pushMessages,
  replyToLine,
  replyToLineMessages,
  showLoadingAnimation
} from "./line-client.js";
import {
  ANTHROPIC_API_KEY,
  ADMIN_LINE_USER_ID,
  db,
  GEMINI_API_KEY,
  LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET
} from "./runtime.js";
import {
  ProfileAuthError,
  verifyFirebaseProfileOwnership,
  verifyLineProfileOwnership,
  verifyProfileOwnership,
  writeProfileAuthAudit,
  type ProfileIdentityRequest,
  type VerifiedProfileOwner
} from "./profile-auth.js";
import { parsePortionAdjustmentCommand } from "./portion-adjustment.js";
import { isDeleteExerciseCommand, looksLikeExerciseLog } from "./exercise-detection.js";
import {
  bangkokLoggedAtForDayKey,
  formatThaiShortDayLabel,
  findRejectedBackdate,
  isBareBackdateCommand,
  MAX_BACKDATE_DAYS,
  parseMealBackdateCommand,
  type RejectedBackdate,
  validateLoggedAtDayKey
} from "./meal-backdate.js";
import { normalizeSupportText, parseSupportReplyControl } from "./support-utils.js";
import {
  DEFAULT_SUBSCRIPTION_PLANS,
  formatSubscriptionPlanLine,
  normalizeSubscriptionPlan,
  parseAdminSubscriptionCommand,
  subscriptionGrantFromPlan,
  subscriptionGrantFromRawInput,
  type AdminSubscriptionCommand,
  type SubscriptionGrant,
  type SubscriptionPlan
} from "./subscription-utils.js";
import { parseConfirmUpdateTargetCommand } from "./target-confirmation.js";
const DEFAULT_APP_RUNTIME_CONFIG: AppRuntimeConfig = {
  legacyGasDashboardUrl: "https://script.google.com/macros/s/AKfycbwDDjb0vMO6kA_8GDxC51PuDzBplDh1d1dx5NPOCbY_Ho5bQvK-W0QfiNL28WUA5fpMCA/exec",
  liffSettingsUrl: "https://liff.line.me/2009365288-Aua3Fli1?page=form&v=20260620b",
  paymentQrImage: "https://img2.pic.in.th/1613478.jpg"
};

const UNREADABLE_FOOD_IMAGE_REPLY = [
  "ยังไม่แน่ใจว่าภาพนี้เป็นอาหารครับ เลยยังไม่ประเมินและไม่บันทึกมื้อนี้",
  "ลองถ่ายใหม่ให้เห็นอาหารทั้งจาน มีแสงชัดขึ้น หรือส่งจากมุมอื่นอีกครั้งนะครับ"
].join("\n");

const AI_PROVIDER_SECRETS = [GEMINI_API_KEY, ANTHROPIC_API_KEY];

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
  program?: {
    type: "cut" | "bulk";
    week: number;
    weeks: number;
    adjustMacro: ProgramMacro;
    status: string;
  } | null;
  expiresAt?: Timestamp | null;
  lifetime?: boolean;
  streak?: {
    count: number;
    lastMealLogDayKey: string | null;
  };
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
  meals: Array<{ name: string; kcal: number }>;
};

type SubscriptionTarget = {
  canonicalUserId: string;
  lineUserId: string | null;
};

type SupportTicketStatus = "open" | "closed";
type SupportTicketState = "waiting-admin" | "waiting-customer" | "closed";

type SubscriptionState = {
  active: boolean;
  lifetime: boolean;
  expiresAt: Timestamp | null;
  status: string;
};

type AppRuntimeConfig = {
  legacyGasDashboardUrl: string;
  liffSettingsUrl: string;
  paymentQrImage: string;
};

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

class LiffMealValidationError extends Error {
  constructor(message: string) {
    super(message);
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
  if (handleCorsPreflight(request, response)) return;

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

  try {
    const owner = await verifyProfileOwnership(request, {
      userId: body.userId,
      canonicalUserId: body.profile.canonicalUserId,
      lineUserId: body.profile.lineUserId,
      firebaseAuthUid: body.profile.firebaseAuthUid
    });
    const canonicalUserId = owner.canonicalUserId ?? body.profile.canonicalUserId ?? body.userId;
    const lineUserId = owner.lineUserId ?? body.profile.lineUserId;
    const firebaseAuthUid = owner.firebaseAuthUid ?? body.profile.firebaseAuthUid;
    const now = Timestamp.now();
    await db.collection("profiles").doc(canonicalUserId).set(
      {
        userId: canonicalUserId,
        canonicalUserId,
        ...body.profile,
        lineUserId: lineUserId ?? null,
        firebaseAuthUid: firebaseAuthUid ?? null,
        authVerified: owner.verified,
        authProvider: owner.provider,
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
          app: Boolean(firebaseAuthUid),
          line: Boolean(lineUserId)
        },
        auth: {
          verified: owner.verified,
          provider: owner.provider
        }
      },
      { merge: true }
    );

    if (lineUserId) {
      await db.collection("lineLinks").doc(lineUserId).set(
        {
          lineUserId,
          canonicalUserId,
          status: "linked",
          updatedAt: now
        },
        { merge: true }
      );
    }

    if (firebaseAuthUid) {
      await db.collection("authLinks").doc(firebaseAuthUid).set(
        {
          firebaseAuthUid,
          canonicalUserId,
          status: "linked",
          updatedAt: now
        },
        { merge: true }
      );
    }

    await writeProfileAuthAudit("updateProfile", canonicalUserId, owner);

    response.json({ ok: true, userId: canonicalUserId, canonicalUserId, authVerified: owner.verified });
  } catch (error) {
    const isAuthError = error instanceof ProfileAuthError;
    response.status(isAuthError ? 401 : 500).json({
      ok: false,
      error: isAuthError ? "profile-auth-failed" : "update-profile-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const saveSettingsFromWeb = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;

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
    const owner = await verifyProfileOwnership(request, {
      userId: body.userId,
      canonicalUserId: body.canonicalUserId,
      lineUserId: body.lineUserId,
      firebaseAuthUid: body.firebaseAuthUid
    });
    const canonicalUserId = owner.canonicalUserId ?? body.canonicalUserId ??
      (body.lineUserId || body.userId.startsWith("U") ? await resolveLineCanonicalUserId(body.lineUserId ?? body.userId) : body.userId);
    const lineUserId = owner.lineUserId ?? body.lineUserId ?? (body.userId.startsWith("U") ? body.userId : undefined);
    const firebaseAuthUid = owner.firebaseAuthUid ?? body.firebaseAuthUid;
    const target = buildTargetFromSettingsConfig(body.config);
    const now = Timestamp.now();
    // If a weekly program is running, rebase it onto the new target so the plan
    // keeps its type/duration/start but recomputes from the fresh week-1 numbers.
    const existingProfileSnap = await db.collection("profiles").doc(canonicalUserId).get();
    const activeProgram = normalizeProgram(existingProfileSnap.exists ? existingProfileSnap.data() ?? {} : {});
    const subscriptionState = await getSubscriptionState(canonicalUserId);
    const expiresAt = subscriptionState.expiresAt ?? (subscriptionState.lifetime ? null : subscriptionExpiryAfterDays(3, null));
    const profilePayload = {
      userId: canonicalUserId,
      canonicalUserId,
      lineUserId: lineUserId ?? null,
      firebaseAuthUid: firebaseAuthUid ?? null,
      displayName: body.displayName ?? undefined,
      gender: normalizeSettingsGender(body.config.gender),
      age: Number(body.config.age ?? 0) || null,
      heightCm: Number(body.config.heightCm ?? body.config.height ?? 0) || null,
      weightKg: Number(body.config.weightKg ?? body.config.weight ?? 0) || null,
      activityFactor: Number(body.config.activityFactor ?? body.config.activity ?? 0) || null,
      goalType: body.config.goalType ?? inferGoalType(Number(body.config.goal ?? 0)),
      target,
      settingsSource: "web-form",
      authVerified: owner.verified,
      authProvider: owner.provider,
      updatedAt: now,
      createdAt: now,
      // Deep-merged: refreshes only the running program's baseline, leaving its
      // type/start/duration/notification state intact.
      ...(activeProgram
        ? {
            program: {
              baseline: {
                calories: target.calories,
                proteinG: target.proteinG,
                carbsG: target.carbsG,
                fatG: target.fatG,
                fiberG: target.fiberG
              },
              updatedAt: now
            }
          }
        : {})
    };

    const writes: Array<Promise<unknown>> = [
      db.collection("profiles").doc(canonicalUserId).set(profilePayload, { merge: true }),
      db.collection("users").doc(canonicalUserId).set({
        userId: canonicalUserId,
        canonicalUserId,
        status: "active",
        source: {
          line: Boolean(lineUserId),
          app: Boolean(firebaseAuthUid)
        },
        auth: {
          verified: owner.verified,
          provider: owner.provider
        },
        updatedAt: now,
        createdAt: now
      }, { merge: true }),
      db.collection("subscriptions").doc(canonicalUserId).set({
        userId: canonicalUserId,
        canonicalUserId,
        status: subscriptionState.lifetime || (expiresAt && expiresAt.toMillis() >= Date.now()) ? "active" : "expired",
        entitlementType: subscriptionState.lifetime ? "lifetime" : "trial",
        lifetime: subscriptionState.lifetime,
        expiresAt,
        trialGranted: subscriptionState.expiresAt || subscriptionState.lifetime ? false : true,
        updatedAt: now,
        createdAt: now
      }, { merge: true }),
      db.collection("profileEvents").add({
        type: "web-settings-save",
        canonicalUserId,
        lineUserId: lineUserId ?? null,
        firebaseAuthUid: firebaseAuthUid ?? null,
        config: sanitizeSettingsConfigForLog(body.config),
        target,
        authVerified: owner.verified,
        authProvider: owner.provider,
        trialGranted: !subscriptionState.expiresAt && !subscriptionState.lifetime,
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
    if (firebaseAuthUid) {
      writes.push(db.collection("authLinks").doc(firebaseAuthUid).set({
        firebaseAuthUid,
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
    await writeProfileAuthAudit("saveSettingsFromWeb", canonicalUserId, owner);

    response.json({
      ok: true,
      canonicalUserId,
      target,
      authVerified: owner.verified,
      trialGranted: !subscriptionState.expiresAt && !subscriptionState.lifetime,
      lifetime: subscriptionState.lifetime,
      expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null
    });
  } catch (error) {
    const isValidationError = error instanceof SettingsValidationError;
    const isAuthError = error instanceof ProfileAuthError;
    response.status(isValidationError ? 400 : isAuthError ? 401 : 500).json({
      ok: false,
      error: isValidationError ? "invalid-settings" : isAuthError ? "profile-auth-failed" : "save-settings-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Saves a weekly CUT/Bulk periodization program on the profile. The baseline is
// read from the profile's currently saved target (so the user sets targets
// first, then layers the program on top). Returns the full week-by-week
// schedule so the client can confirm before the plan takes effect.
export const saveWeeklyProgram = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as SaveWeeklyProgramRequest;
  if (!body?.userId) {
    response.status(400).json({ ok: false, error: "missing-user-id" });
    return;
  }

  try {
    if (!isSafePublicId(body.userId)) throw new SettingsValidationError("invalid userId");
    if (body.canonicalUserId && !isSafePublicId(body.canonicalUserId)) {
      throw new SettingsValidationError("invalid canonicalUserId");
    }
    if (body.lineUserId && !isSafePublicId(body.lineUserId)) throw new SettingsValidationError("invalid lineUserId");
    if (body.firebaseAuthUid && !isSafePublicId(body.firebaseAuthUid)) {
      throw new SettingsValidationError("invalid firebaseAuthUid");
    }

    const type = body.type === "bulk" ? "bulk" : body.type === "cut" ? "cut" : null;
    if (!type) throw new SettingsValidationError("invalid program type");
    const weeks = Math.round(Number(body.weeks));
    const stepKcalPerWeek = Math.abs(Number(body.stepKcalPerWeek));
    assertNumberInRange("weeks", weeks, 1, 52);
    assertNumberInRange("stepKcalPerWeek", stepKcalPerWeek, 10, 1000);
    const adjustMacro: ProgramMacro =
      body.adjustMacro === "fat" || body.adjustMacro === "protein" ? body.adjustMacro : "carbs";
    const immediateStart = body.immediateStart !== false;
    const startDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.startDate ?? ""))
      ? String(body.startDate)
      : bangkokDateString(new Date());

    const owner = await verifyProfileOwnership(request, {
      userId: body.userId,
      canonicalUserId: body.canonicalUserId,
      lineUserId: body.lineUserId,
      firebaseAuthUid: body.firebaseAuthUid
    });
    const canonicalUserId = owner.canonicalUserId ?? body.canonicalUserId ??
      (body.lineUserId || body.userId.startsWith("U") ? await resolveLineCanonicalUserId(body.lineUserId ?? body.userId) : body.userId);
    const lineUserId = owner.lineUserId ?? body.lineUserId ?? (body.userId.startsWith("U") ? body.userId : undefined);

    const profileSnap = await db.collection("profiles").doc(canonicalUserId).get();
    const baseTarget = normalizeTarget(profileSnap.exists ? profileSnap.data() ?? {} : {});
    if (baseTarget.cal <= 0 || baseTarget.p <= 0 || baseTarget.c <= 0 || baseTarget.f <= 0) {
      throw new SettingsValidationError("set-targets-first");
    }

    const baseline: ProgramBaseline = {
      calories: baseTarget.cal,
      proteinG: baseTarget.p,
      carbsG: baseTarget.c,
      fatG: baseTarget.f,
      fiberG: baseTarget.fib
    };
    const program: WeeklyProgram = { type, startDate, weeks, stepKcalPerWeek, adjustMacro, immediateStart, baseline, status: "active" };
    const schedule = buildProgramScheduleRows(baseline, program);
    const now = Timestamp.now();

    await Promise.all([
      db.collection("profiles").doc(canonicalUserId).set(
        // lastNotifiedWeek starts at 1: week-1 is already in effect at save time,
        // so the weekly notifier only pushes when the plan advances to week 2+.
        { program: { ...program, lastNotifiedWeek: 1, updatedAt: now, createdAt: now }, updatedAt: now },
        { merge: true }
      ),
      db.collection("profileEvents").add({
        type: "weekly-program-save",
        canonicalUserId,
        lineUserId: lineUserId ?? null,
        program,
        authVerified: owner.verified,
        authProvider: owner.provider,
        createdAt: now
      })
    ]);
    await writeProfileAuthAudit("saveWeeklyProgram", canonicalUserId, owner);

    response.json({ ok: true, canonicalUserId, program, schedule });
  } catch (error) {
    const isValidationError = error instanceof SettingsValidationError;
    const isAuthError = error instanceof ProfileAuthError;
    response.status(isValidationError ? 400 : isAuthError ? 401 : 500).json({
      ok: false,
      error: isValidationError ? "invalid-program" : isAuthError ? "profile-auth-failed" : "save-program-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// Ends an active weekly program. Marks it "completed" (deep-merged) rather than
// deleting the map, so the schedule history stays on the profile but the plain
// saved target applies again from now on.
export const cancelWeeklyProgram = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as CancelWeeklyProgramRequest;
  if (!body?.userId) {
    response.status(400).json({ ok: false, error: "missing-user-id" });
    return;
  }

  try {
    if (!isSafePublicId(body.userId)) throw new SettingsValidationError("invalid userId");
    if (body.canonicalUserId && !isSafePublicId(body.canonicalUserId)) {
      throw new SettingsValidationError("invalid canonicalUserId");
    }
    if (body.lineUserId && !isSafePublicId(body.lineUserId)) throw new SettingsValidationError("invalid lineUserId");
    if (body.firebaseAuthUid && !isSafePublicId(body.firebaseAuthUid)) {
      throw new SettingsValidationError("invalid firebaseAuthUid");
    }

    const owner = await verifyProfileOwnership(request, {
      userId: body.userId,
      canonicalUserId: body.canonicalUserId,
      lineUserId: body.lineUserId,
      firebaseAuthUid: body.firebaseAuthUid
    });
    const canonicalUserId = owner.canonicalUserId ?? body.canonicalUserId ??
      (body.lineUserId || body.userId.startsWith("U") ? await resolveLineCanonicalUserId(body.lineUserId ?? body.userId) : body.userId);
    const now = Timestamp.now();

    await db.collection("profiles").doc(canonicalUserId).set(
      { program: { status: "completed", updatedAt: now }, updatedAt: now },
      { merge: true }
    );

    response.json({ ok: true, canonicalUserId });
  } catch (error) {
    const isValidationError = error instanceof SettingsValidationError;
    const isAuthError = error instanceof ProfileAuthError;
    response.status(isValidationError ? 400 : isAuthError ? 401 : 500).json({
      ok: false,
      error: isValidationError ? "invalid-program" : isAuthError ? "profile-auth-failed" : "cancel-program-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const linkLineAccount = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as LinkLineAccountRequest;
  if (!body?.lineUserId || !body?.firebaseAuthUid) {
    response.status(400).json({ ok: false, error: "missing-link-identity" });
    return;
  }
  if (!isSafePublicId(body.lineUserId) || !isSafePublicId(body.firebaseAuthUid)) {
    response.status(400).json({ ok: false, error: "invalid-link-identity" });
    return;
  }

  try {
    const firebaseOwner = await verifyFirebaseProfileOwnership(request, {
      userId: body.firebaseAuthUid,
      firebaseAuthUid: body.firebaseAuthUid
    });
    const lineOwner = await verifyLineProfileOwnership(request, {
      userId: body.lineUserId,
      lineUserId: body.lineUserId
    });
    const firebaseAuthUid = firebaseOwner.firebaseAuthUid;
    const lineUserId = lineOwner.lineUserId;
    if (!firebaseAuthUid || !lineUserId) {
      throw new ProfileAuthError("verified identities are incomplete");
    }

    const now = Timestamp.now();
    const result = await db.runTransaction(async (transaction) => {
      const authRef = db.collection("authLinks").doc(firebaseAuthUid);
      const lineRef = db.collection("lineLinks").doc(lineUserId);
      const [authSnap, lineSnap] = await Promise.all([
        transaction.get(authRef),
        transaction.get(lineRef)
      ]);
      const authCanonicalUserId = authSnap.exists ? String(authSnap.data()?.canonicalUserId ?? "") : "";
      const lineCanonicalUserId = lineSnap.exists ? String(lineSnap.data()?.canonicalUserId ?? "") : "";
      if (authCanonicalUserId && lineCanonicalUserId && authCanonicalUserId !== lineCanonicalUserId) {
        throw new ProfileAuthError("Firebase account is already linked to a different LINE account");
      }

      const canonicalUserId = lineCanonicalUserId || authCanonicalUserId || lineUserId;
      transaction.set(lineRef, {
        lineUserId,
        canonicalUserId,
        status: "linked",
        updatedAt: now,
        createdAt: lineSnap.exists ? lineSnap.data()?.createdAt ?? now : now
      }, { merge: true });
      transaction.set(authRef, {
        firebaseAuthUid,
        canonicalUserId,
        status: "linked",
        updatedAt: now,
        createdAt: authSnap.exists ? authSnap.data()?.createdAt ?? now : now
      }, { merge: true });
      transaction.set(db.collection("users").doc(canonicalUserId), {
        userId: canonicalUserId,
        canonicalUserId,
        status: "active",
        source: {
          app: true,
          line: true
        },
        auth: {
          verified: true,
          provider: "firebase+line"
        },
        updatedAt: now,
        createdAt: now
      }, { merge: true });
      transaction.set(db.collection("profiles").doc(canonicalUserId), {
        userId: canonicalUserId,
        canonicalUserId,
        lineUserId,
        firebaseAuthUid,
        authVerified: true,
        authProvider: "firebase+line",
        updatedAt: now,
        createdAt: now
      }, { merge: true });

      return { canonicalUserId };
    });

    await Promise.all([
      writeProfileAuthAudit("linkLineAccount", result.canonicalUserId, { ...firebaseOwner, canonicalUserId: result.canonicalUserId }),
      writeProfileAuthAudit("linkLineAccount", result.canonicalUserId, { ...lineOwner, canonicalUserId: result.canonicalUserId })
    ]);

    response.json({
      ok: true,
      canonicalUserId: result.canonicalUserId,
      lineUserId,
      firebaseAuthUid,
      authVerified: true
    });
  } catch (error) {
    if (error instanceof ProfileAuthError) {
      sendProfileAuthError(response, error);
      return;
    }
    response.status(500).json({
      ok: false,
      error: "link-line-account-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

function handleCorsPreflight(request: Parameters<Parameters<typeof onRequest>[0]>[0], response: Parameters<Parameters<typeof onRequest>[0]>[1]) {
  response.set("Access-Control-Allow-Origin", String(request.get("origin") ?? "*"));
  response.set("Vary", "Origin");
  response.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Line-Id-Token");
  response.set("Access-Control-Max-Age", "3600");
  if (request.method === "OPTIONS") {
    response.status(204).send("");
    return true;
  }
  return false;
}

async function requireVerifiedProfileOwner(
  request: Parameters<Parameters<typeof onRequest>[0]>[0],
  identity: ProfileIdentityRequest
): Promise<VerifiedProfileOwner & { canonicalUserId: string }> {
  const owner = await verifyProfileOwnership(request, identity);
  if (!owner.verified || !owner.canonicalUserId) {
    throw new ProfileAuthError("missing verified profile owner");
  }
  return { ...owner, canonicalUserId: owner.canonicalUserId };
}

function profileIdentityFromRequestBody(body: {
  userId?: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
}): ProfileIdentityRequest {
  return {
    userId: body.userId ?? body.canonicalUserId ?? body.lineUserId ?? body.firebaseAuthUid ?? "",
    canonicalUserId: body.canonicalUserId,
    lineUserId: body.lineUserId,
    firebaseAuthUid: body.firebaseAuthUid
  };
}

function sendProfileAuthError(
  response: Parameters<Parameters<typeof onRequest>[0]>[1],
  error: unknown
) {
  response.status(401).json({
    ok: false,
    error: "profile-auth-failed",
    message: error instanceof Error ? error.message : String(error)
  });
}

function sendReadinessGate(
  response: Parameters<Parameters<typeof onRequest>[0]>[1],
  readiness: UserReadiness
) {
  if (!readiness.profileComplete) {
    response.status(403).json({ ok: false, error: "profile-required" });
    return true;
  }
  if (!readiness.subscriptionActive) {
    response.status(403).json({
      ok: false,
      error: "subscription-required",
      expiresAt: readiness.expiresAt ? readiness.expiresAt.toDate().toISOString() : null
    });
    return true;
  }
  return false;
}

function hasVerifiedIdentityHeader(request: Parameters<Parameters<typeof onRequest>[0]>[0]) {
  return Boolean((request.get("authorization") ?? "").trim() || (request.get("x-line-id-token") ?? "").trim());
}

function isDashboardAuthRequired() {
  return (process.env.DASHBOARD_AUTH_MODE ?? "required").toLowerCase() === "required";
}

const DASHBOARD_ACCESS_TTL_MS = 60 * 60 * 1000;

function dashboardAccessTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function resolveDashboardAccessToken(token: string) {
  if (!/^[A-Za-z0-9_-]{40,128}$/.test(token)) {
    throw new ProfileAuthError("invalid dashboard access token");
  }

  const ref = db.collection("dashboardAccessSessions").doc(dashboardAccessTokenHash(token));
  const snap = await ref.get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const expiresAt = data.expiresAt instanceof Timestamp ? data.expiresAt.toMillis() : 0;
  const canonicalUserId = typeof data.canonicalUserId === "string" ? data.canonicalUserId : "";
  if (!canonicalUserId || expiresAt <= Date.now()) {
    if (snap.exists) await ref.delete();
    throw new ProfileAuthError("dashboard access token is missing or expired");
  }
  return canonicalUserId;
}

async function resolveDashboardCanonicalUserId(
  request: Parameters<Parameters<typeof onRequest>[0]>[0],
  body: DashboardDataRequest
) {
  if (hasVerifiedIdentityHeader(request)) {
    const owner = await requireVerifiedProfileOwner(request, profileIdentityFromRequestBody(body));
    return {
      canonicalUserId: owner.canonicalUserId,
      authVerified: true,
      authProvider: owner.provider
    };
  }

  if (body.dashboardAccessToken) {
    return {
      canonicalUserId: await resolveDashboardAccessToken(body.dashboardAccessToken),
      authVerified: true,
      authProvider: "dashboard-link"
    };
  }

  if (isDashboardAuthRequired()) {
    throw new ProfileAuthError("missing verified dashboard owner");
  }

  return {
    canonicalUserId: await resolveCanonicalUserId({ ...body, userId: body.userId ?? "" }),
    authVerified: false,
    authProvider: "none"
  };
}

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
  let proteinG = 0;
  let carbsG = 0;
  let fatG = 0;

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

    // Mifflin-St Jeor BMR -> maintenance TDEE.
    const bmr = (10 * weightKg) + (6.25 * heightCm) - (5 * age) + (normalizeSettingsGender(config.gender) === "male" ? 5 : -161);
    const maintenance = bmr * activityFactor;

    // Goal as a PERCENTAGE of maintenance (the form's kcal value selects the goal
    // type), floored so the target never drops below BMR — safer than a fixed
    // kcal delta that hits small and large bodies very differently.
    const goalType = inferGoalType(Number(config.goal ?? 0));
    const goalPct = goalType === "fat_loss" ? -0.18 : goalType === "recomp" ? -0.08 : goalType === "muscle_gain" ? 0.12 : 0;
    finalTdee = Math.max(Math.round(bmr), 1200, Math.round(maintenance * (1 + goalPct)));

    // Protein by body weight (g/kg) — higher when cutting or gaining to protect/build muscle.
    const proteinPerKg = (goalType === "fat_loss" || goalType === "muscle_gain") ? 2.0 : 1.8;
    proteinG = Math.round(weightKg * proteinPerKg);

    // Split the remaining calories into carbs/fat by the chosen diet style, with a
    // minimum dietary fat (0.8 g/kg) for hormonal health.
    const { carbsPct: styleCarb, fatPct: styleFat } = macroPercentagesForDietStyle(config.dietStyle);
    const remainingCal = Math.max(0, finalTdee - proteinG * 4);
    const cfTotal = styleCarb + styleFat || 1;
    fatG = Math.max(Math.round(0.8 * weightKg), Math.round((remainingCal * (styleFat / cfTotal)) / 9));
    carbsG = Math.max(0, Math.round((finalTdee - proteinG * 4 - fatG * 9) / 4));
  } else {
    finalTdee = Math.round(Number(config.tdee ?? 0));
    const proteinPct = Number(config.p ?? 0);
    const carbsPct = Number(config.c ?? 0);
    const fatPct = Number(config.f ?? 0);
    for (const [name, value] of Object.entries({ proteinPct, carbsPct, fatPct })) {
      assertNumberInRange(name, value, 1, 80);
    }
    if (proteinPct + carbsPct + fatPct < 90 || proteinPct + carbsPct + fatPct > 110) {
      throw new SettingsValidationError("macro percentages should add up close to 100");
    }
    proteinG = Math.round((finalTdee * proteinPct / 100) / 4);
    carbsG = Math.round((finalTdee * carbsPct / 100) / 4);
    fatG = Math.round((finalTdee * fatPct / 100) / 9);
  }

  if (!Number.isFinite(finalTdee) || finalTdee < 800 || finalTdee > 6000) {
    throw new SettingsValidationError("invalid TDEE");
  }

  // Fiber target follows the 14 g per 1000 kcal dietary guideline.
  const fiberG = Math.round((finalTdee / 1000) * 14);

  return {
    calories: Math.round(finalTdee),
    proteinPct: Math.round((proteinG * 4 / finalTdee) * 100),
    carbsPct: Math.round((carbsG * 4 / finalTdee) * 100),
    fatPct: Math.round((fatG * 9 / finalTdee) * 100),
    proteinG,
    carbsG,
    fatG,
    fiberG
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
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as DashboardDataRequest;
  if (!body?.userId && !body?.dashboardAccessToken) {
    response.status(400).json({ ok: false, error: "missing-dashboard-identity" });
    return;
  }

  try {
    const dashboardOwner = await resolveDashboardCanonicalUserId(request, body);
    const canonicalUserId = dashboardOwner.canonicalUserId;
    const { startDate, endDate } = resolveDashboardRange(body);
    const history = buildDailyHistory(startDate, endDate);
    const profileSnap = await db.collection("profiles").doc(canonicalUserId).get();
    const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
    const target = resolveEffectiveTarget(profile);

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
    const daily = [];
    const cursor = new Date(startDate);
    while (cursor <= endDate) {
      const key = formatDayKey(cursor);
      const bucket = history[key];
      if (bucket) {
        daily.push({
          date: key,
          isoDate: formatBangkokIsoDayKey(cursor),
          calories: bucket.cal,
          proteinG: bucket.p,
          carbsG: bucket.c,
          fatG: bucket.f,
          fiberG: bucket.fib,
          burnedCalories: bucket.burn,
          dynamicTargetCalories: target.cal + bucket.burn,
          remainingCalories: target.cal + bucket.burn - bucket.cal,
          weightKg: bucket.weight,
          bodyFatPct: bucket.fat,
          muscleMassKg: bucket.muscle,
          deviceName: bucket.device
        });
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    response.json({
      ok: true,
      canonicalUserId,
      authVerified: dashboardOwner.authVerified,
      authProvider: dashboardOwner.authProvider,
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
      program: target.program,
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
  } catch (error) {
    if (error instanceof ProfileAuthError) {
      sendProfileAuthError(response, error);
      return;
    }
    response.status(500).json({
      ok: false,
      error: "dashboard-data-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

// These endpoints are intentionally separate from the chat command flow.  The
// LIFF UI always sends an authenticated LINE ID token and a specific meal ID so
// a tap on an older Flex card can never mutate whichever meal happens to be
// newest at the time of the request.
export const getMealForLiff = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  const body = request.body as GetMealForLiffRequest;
  try {
    const owner = await resolveLiffMealOwner(request, body);
    const meal = await getOwnedMealLog(owner.canonicalUserId, body.mealLogId);
    if (!meal) {
      response.status(404).json({ ok: false, error: "meal-not-found" });
      return;
    }
    response.json({ ok: true, meal: serializeMealForLiff(meal.id, meal.data() ?? {}) });
  } catch (error) {
    respondToLiffMealError(response, error);
  }
});

export const saveMealEditFromLiff = onRequest(
  { secrets: [...AI_PROVIDER_SECRETS, LINE_CHANNEL_ACCESS_TOKEN], timeoutSeconds: 90 },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }
    const body = request.body as SaveMealEditFromLiffRequest;
    try {
      const owner = await resolveLiffMealOwner(request, body);
      const meal = await getOwnedMealLog(owner.canonicalUserId, body.mealLogId);
      if (!meal) {
        response.status(404).json({ ok: false, error: "meal-not-found" });
        return;
      }
      const correctionText = normalizeLiffCorrectionText(body.correctionText);
      if (correctionText) {
        const result = await replaceLatestMealWithCorrection(
          owner.canonicalUserId,
          correctionText,
          "แก้ไขจาก LIFF",
          meal
        );
        const pushDelivered = result.corrected && result.mealLogId
          ? await pushRefreshedMealCard(owner.canonicalUserId, owner.lineUserId, result.mealLogId)
          : false;
        response.json({ ok: result.corrected, mode: "reanalyzed", pushDelivered, ...result });
        return;
      }
      const adjustment = liffPortionAdjustment(body.portionRatio);
      if (!adjustment) throw new LiffMealValidationError("select a valid portion or add a correction");
      const result = await adjustMealPortion(meal, adjustment, "แก้ไขปริมาณจาก LIFF");
      const pushDelivered = result.adjusted
        ? await pushRefreshedMealCard(owner.canonicalUserId, owner.lineUserId, meal.id)
        : false;
      response.json({ ok: result.adjusted, mode: "portion", pushDelivered, ...result });
    } catch (error) {
      respondToLiffMealError(response, error);
    }
  }
);

export const previewLeftoverFromLiff = onRequest(
  { secrets: AI_PROVIDER_SECRETS, timeoutSeconds: 90 },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }
    const body = request.body as PreviewLeftoverFromLiffRequest;
    try {
      const owner = await resolveLiffMealOwner(request, body);
      const meal = await getOwnedMealLog(owner.canonicalUserId, body.mealLogId);
      if (!meal) {
        response.status(404).json({ ok: false, error: "meal-not-found" });
        return;
      }
      const preview = await createLiffLeftoverPreview({
        canonicalUserId: owner.canonicalUserId,
        lineUserId: owner.lineUserId,
        meal,
        imageBase64: validateLiffImage(body.imageBase64),
        mimeType: validateLiffImageMimeType(body.mimeType)
      });
      response.json({ ok: true, preview });
    } catch (error) {
      respondToLiffMealError(response, error);
    }
  }
);

export const confirmLeftoverFromLiff = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  const body = request.body as ConfirmLeftoverFromLiffRequest;
  try {
    const owner = await resolveLiffMealOwner(request, body);
    const result = await confirmLiffLeftoverPreview(owner.canonicalUserId, body.previewId);
    response.json({ ok: true, ...result });
  } catch (error) {
    respondToLiffMealError(response, error);
  }
});

export const deleteMealFromLiff = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  const body = request.body as DeleteMealFromLiffRequest;
  try {
    const owner = await resolveLiffMealOwner(request, body);
    const meal = await getOwnedMealLog(owner.canonicalUserId, body.mealLogId);
    if (!meal) {
      response.status(404).json({ ok: false, error: "meal-not-found" });
      return;
    }
    const data = meal.data() ?? {};
    const mealNameTh = String(data.mealNameTh ?? data.mealNameEn ?? "มื้ออาหาร");
    await meal.ref.delete();
    await db.collection("profileEvents").add({
      type: "meal-delete-from-liff",
      canonicalUserId: owner.canonicalUserId,
      lineUserId: owner.lineUserId,
      mealLogId: meal.id,
      mealNameTh,
      deletedAt: Timestamp.now()
    });
    response.json({ ok: true, mealLogId: meal.id, mealNameTh });
  } catch (error) {
    respondToLiffMealError(response, error);
  }
});

export const getExerciseForLiff = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  const body = request.body as GetExerciseForLiffRequest;
  try {
    const owner = await resolveLiffMealOwner(request, body);
    const exercise = await getOwnedExerciseLog(owner.canonicalUserId, body.exerciseLogId);
    if (!exercise) {
      response.status(404).json({ ok: false, error: "exercise-not-found", message: "ไม่พบรายการออกกำลังกายนี้" });
      return;
    }
    response.json({ ok: true, exercise: serializeExerciseForLiff(exercise.id, exercise.data() ?? {}) });
  } catch (error) {
    respondToLiffMealError(response, error);
  }
});

export const deleteExerciseFromLiff = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  const body = request.body as DeleteExerciseFromLiffRequest;
  try {
    const owner = await resolveLiffMealOwner(request, body);
    const exercise = await getOwnedExerciseLog(owner.canonicalUserId, body.exerciseLogId);
    if (!exercise) {
      response.status(404).json({ ok: false, error: "exercise-not-found", message: "ไม่พบรายการออกกำลังกายนี้" });
      return;
    }

    const data = exercise.data() ?? {};
    const activityName = String(data.activityName ?? data.exerciseName ?? "ออกกำลังกาย");
    const caloriesBurned = Math.max(0, Math.round(Number(data.caloriesBurned ?? 0)));
    const eventRef = db.collection("profileEvents").doc();
    const batch = db.batch();
    batch.delete(exercise.ref);
    batch.set(eventRef, {
      type: "exercise-delete-from-liff",
      canonicalUserId: owner.canonicalUserId,
      lineUserId: owner.lineUserId,
      exerciseLogId: exercise.id,
      activityName,
      caloriesBurned,
      deletedAt: Timestamp.now()
    });
    await batch.commit();

    const profile = await getUserProfile(owner.canonicalUserId);
    const summary = await getTodaySummary(owner.canonicalUserId, profile);
    response.json({
      ok: true,
      exerciseLogId: exercise.id,
      activityName,
      removedCalorieCredit: caloriesBurned,
      today: {
        dynamicTargetCalories: Math.round(summary.dynamicTarget),
        remainingCalories: Math.round(summary.remaining.cal)
      }
    });
  } catch (error) {
    respondToLiffMealError(response, error);
  }
});

// Allowlist of admin Google accounts for the admin web app. Move to Firestore
// config once the admin app can manage it.
const ADMIN_EMAILS = ["znak.iiz@gmail.com"];
const ADMIN_AI_AGENT_IDS = ["mealAnalysis", "exerciseAnalysis", "biaAnalysis", "coachConsultation"] as const;

function isAdminAiAgentId(value: string): value is (typeof ADMIN_AI_AGENT_IDS)[number] {
  return ADMIN_AI_AGENT_IDS.includes(value as (typeof ADMIN_AI_AGENT_IDS)[number]);
}

function normalizeAdminModelId(value: unknown): string | null {
  const model = String(value ?? "").trim();
  if (model.length < 2 || model.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(model)) return null;
  return model;
}

async function requireAdminEmail(request: Parameters<Parameters<typeof onRequest>[0]>[0]): Promise<string> {
  const header = request.get("authorization") ?? "";
  const token = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (!token) throw new Error("missing-admin-token");
  const decoded = await getAuth().verifyIdToken(token);
  const email = decoded.email?.toLowerCase();
  if (!email || !decoded.email_verified || !ADMIN_EMAILS.includes(email)) {
    throw new Error("not-authorized");
  }
  return email;
}

export const getAdminMonitoring = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  let adminEmail: string;
  try {
    adminEmail = await requireAdminEmail(request);
  } catch (error) {
    response.status(401).json({ ok: false, error: "admin-auth-failed", message: error instanceof Error ? error.message : String(error) });
    return;
  }

  try {
  const now = Timestamp.now();
  const nowMs = now.toMillis();
  const day = 24 * 60 * 60 * 1000;
  const since7 = Timestamp.fromMillis(nowMs - 7 * day);
  const since14 = Timestamp.fromMillis(nowMs - 14 * day);
  const since30 = Timestamp.fromMillis(nowMs - 30 * day);
  const { startDate: todayStart } = getBangkokDayRange(new Date());
  const todayMs = todayStart.getTime();
  const ms7 = since7.toMillis();

  // Avoid a status+createdAt composite index by fetching pending reviews
  // unordered and sorting in memory.
  const [usersCount, expiredSubs, newUsers7, mealsToday, pendingSnap, aiRunsSnap, meals14Snap, reviews30Snap, activeSubsSnap, profilesSnap, auditSnap, aiAgentsSnap, openSupportCount] = await Promise.all([
    db.collection("users").count().get(),
    db.collection("subscriptions").where("expiresAt", "<", now).count().get(),
    db.collection("users").where("createdAt", ">=", since7).count().get(),
    db.collection("mealLogs").where("loggedAt", ">=", Timestamp.fromDate(todayStart)).count().get(),
    db.collection("paymentReviews").where("status", "==", "pending-admin-review").limit(450).get(),
    db.collection("aiRuns").where("createdAt", ">=", since7).get(),
    db.collection("mealLogs").where("loggedAt", ">=", since14).get(),
    db.collection("paymentReviews").where("createdAt", ">=", since30).get(),
    db.collection("subscriptions").where("status", "==", "active").get(),
    db.collection("profiles").get(),
    db.collection("adminAuditLogs").orderBy("createdAt", "desc").limit(60).get(),
    db.collection("aiAgents").get(),
    db.collection("supportTickets").where("status", "==", "open").count().get()
  ]);

  let aiTotal = 0, aiFallback = 0, aiFailed = 0, ai24 = 0, aiFallback24 = 0;
  const ms24 = nowMs - day;
  // Per-agent breakdown so the operator sees exactly which AI tasks are degraded.
  const aiByAgent: Record<string, { runs7d: number; fallback7d: number; failed7d: number; runs24h: number; fallback24h: number; lastFallbackAt: string | null }> = {};
  aiRunsSnap.forEach((doc) => {
    const data = doc.data();
    aiTotal += 1;
    if (data.fallbackUsed) aiFallback += 1;
    if (data.status === "failed") aiFailed += 1;
    const ts = normalizeTimestamp(data.createdAt);
    const within24 = Boolean(ts && ts.toMillis() >= ms24);
    if (within24) { ai24 += 1; if (data.fallbackUsed) aiFallback24 += 1; }
    const agent = String(data.agentId ?? "unknown");
    const a = aiByAgent[agent] ?? (aiByAgent[agent] = { runs7d: 0, fallback7d: 0, failed7d: 0, runs24h: 0, fallback24h: 0, lastFallbackAt: null });
    a.runs7d += 1;
    if (data.fallbackUsed) { a.fallback7d += 1; const iso = timestampToIso(data.createdAt); if (iso && (!a.lastFallbackAt || iso > a.lastFallbackAt)) a.lastFallbackAt = iso; }
    if (data.status === "failed") a.failed7d += 1;
    if (within24) { a.runs24h += 1; if (data.fallbackUsed) a.fallback24h += 1; }
  });

  // Distinct active users + last-log time per user, derived from the meal snapshot.
  const activeToday = new Set<string>();
  const active7d = new Set<string>();
  const lastLogMs: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (let i = 13; i >= 0; i -= 1) byDay[formatDayKey(new Date(nowMs - i * day))] = 0;
  meals14Snap.forEach((doc) => {
    const data = doc.data();
    const ts = normalizeTimestamp(data.loggedAt);
    if (!ts) return;
    const key = formatDayKey(ts.toDate());
    if (key in byDay) byDay[key] += 1;
    const uid = String(data.canonicalUserId ?? data.userId ?? "");
    if (!uid) return;
    const ms = ts.toDate().getTime();
    if (ms >= ms7) active7d.add(uid);
    if (ms >= todayMs) activeToday.add(uid);
    if (!lastLogMs[uid] || ms > lastLogMs[uid]) lastLogMs[uid] = ms;
  });

  // Approved-slip revenue over the last 30 days.
  let revenue30 = 0;
  const latestDecisionAtByUser = new Map<string, number>();
  reviews30Snap.forEach((doc) => {
    const data = doc.data();
    if (data.status === "approved") revenue30 += Number(data.amount ?? data.slipData?.amount) || 0;
    if (data.status === "pending-admin-review") return;
    const canonicalUserId = String(data.canonicalUserId ?? "");
    const decidedAt = normalizeTimestamp(data.reviewedAt ?? data.updatedAt);
    if (!canonicalUserId || !decidedAt) return;
    latestDecisionAtByUser.set(
      canonicalUserId,
      Math.max(latestDecisionAtByUser.get(canonicalUserId) ?? 0, decidedAt.toMillis())
    );
  });

  // Retention: paying users (active subscription) who have gone quiet. No meal in
  // the 14-day window means they're not in lastLogMs at all = highest risk.
  const names: Record<string, string> = {};
  profilesSnap.forEach((doc) => { names[doc.id] = String(doc.data().displayName ?? "Member"); });
  const activeSubscriptionDocs = activeSubsSnap.docs.filter((doc) => {
    const data = doc.data();
    const expiresAt = normalizeTimestamp(data.expiresAt);
    return isLifetimeSubscription(data) || Boolean(expiresAt && expiresAt.toMillis() >= nowMs);
  });
  const subList = activeSubscriptionDocs.map((doc) => {
    const uid = doc.id;
    const last = lastLogMs[uid];
    const quietDays = last ? Math.floor((nowMs - last) / day) : 99;
    const expiresAt = normalizeTimestamp(doc.data().expiresAt);
    const lifetime = isLifetimeSubscription(doc.data());
    const expiresInDays = lifetime ? null : (expiresAt ? Math.round((expiresAt.toMillis() - nowMs) / day) : null);
    return { canonicalUserId: uid, name: names[uid] ?? "Member", quietDays, expiresInDays, lifetime };
  });
  const atRisk = subList.filter((u) => u.quietDays >= 5).sort((a, b) => b.quietDays - a.quietDays).slice(0, 25);
  const expiringSoonAll = subList
    .filter((u) => !u.lifetime && u.expiresInDays !== null && u.expiresInDays <= 7)
    .sort((a, b) => (a.expiresInDays ?? 0) - (b.expiresInDays ?? 0));
  const expiringSoonList = expiringSoonAll.slice(0, 25);
  const activeSubEngaged7d = activeSubscriptionDocs.filter((doc) => active7d.has(doc.id)).length;

  // Recently-expired subscriptions (win-back targets): expired within 60 days.
  const expiredRecentSnap = await db.collection("subscriptions")
    .where("expiresAt", "<", now)
    .where("expiresAt", ">=", Timestamp.fromMillis(nowMs - 60 * day))
    .get();
  const expiredList = expiredRecentSnap.docs.filter((doc) => !isLifetimeSubscription(doc.data())).map((doc) => {
    const uid = doc.id;
    const expiresAt = normalizeTimestamp(doc.data().expiresAt);
    const last = lastLogMs[uid];
    return {
      canonicalUserId: uid,
      name: names[uid] ?? "Member",
      daysExpired: expiresAt ? Math.floor((nowMs - expiresAt.toMillis()) / day) : null,
      quietDays: last ? Math.floor((nowMs - last) / day) : 99
    };
  }).filter((u) => u.daysExpired !== null).sort((a, b) => (a.daysExpired ?? 0) - (b.daysExpired ?? 0)).slice(0, 30);

  // Reliability: a feed of recent failures the operator should act on.
  const errorFeed: Array<{ at: string | null; kind: string; detail: string }> = [];
  aiRunsSnap.forEach((doc) => {
    const data = doc.data();
    if (data.status !== "failed") return;
    errorFeed.push({ at: timestampToIso(data.createdAt), kind: `AI ${String(data.inputType ?? "")}`.trim(), detail: String(data.error ?? "ai-run-failed").slice(0, 160) });
  });
  auditSnap.forEach((doc) => {
    const data = doc.data();
    const tag = `${data.type ?? ""}/${data.status ?? ""}`;
    if (!/error|fail|reject|unhandled/i.test(tag)) return;
    errorFeed.push({ at: timestampToIso(data.createdAt), kind: String(data.type ?? "event"), detail: String(data.message ?? data.error ?? tag).slice(0, 160) });
  });
  errorFeed.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")));
  const errors24h = errorFeed.filter((e) => e.at && Date.parse(e.at) >= nowMs - day).length;

  // AI provider routing (so the operator can see + flip primary on overload).
  const aiConfig: Record<string, { provider: string; model: string; fallback: string | null; fallbackModel: string | null; updatedBy: string | null; updatedAt: string | null }> = {};
  aiAgentsSnap.forEach((doc) => {
    const data = doc.data();
    const fallback = Array.isArray(data.fallbacks) && data.fallbacks[0]
      ? data.fallbacks[0] as Record<string, unknown>
      : null;
    aiConfig[doc.id] = {
      provider: String(data.provider ?? "?"),
      model: String(data.model ?? "?"),
      fallback: fallback ? String(fallback.provider ?? "?") : null,
      fallbackModel: fallback ? String(fallback.model ?? "?") : null,
      updatedBy: data.updatedBy ? String(data.updatedBy) : null,
      updatedAt: timestampToIso(data.updatedAt)
    };
  });

  // Older duplicate slips can survive when an operator approves only the newest
  // one. A later decision for the same user makes those older rows non-actionable.
  const actionablePendingDocs = pendingSnap.docs.filter((doc) => {
    const data = doc.data();
    const canonicalUserId = String(data.canonicalUserId ?? "");
    const createdAt = normalizeTimestamp(data.createdAt);
    const latestDecisionAt = latestDecisionAtByUser.get(canonicalUserId);
    return !createdAt || !latestDecisionAt || createdAt.toMillis() > latestDecisionAt;
  });
  const pending = actionablePendingDocs.map((doc) => {
    const data = doc.data();
    return {
      id: doc.id,
      lineUserId: data.lineUserId ?? null,
      canonicalUserId: data.canonicalUserId ?? null,
      amount: data.amount ?? data.slipData?.amount ?? null,
      createdAt: timestampToIso(data.createdAt)
    };
  }).sort((a, b) => String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""))).slice(0, 20);

  response.json({
    ok: true,
    admin: adminEmail,
    generatedAt: now.toDate().toISOString(),
    cards: {
      users: usersCount.data().count,
      newUsers7d: newUsers7.data().count,
      activeToday: activeToday.size,
      active7d: active7d.size,
      activeSubscriptions: activeSubscriptionDocs.length,
      expiringSoon: expiringSoonAll.length,
      expired: expiredSubs.data().count,
      revenue30d: revenue30,
      pendingReviews: actionablePendingDocs.length,
      supportOpen: openSupportCount.data().count,
      mealsToday: mealsToday.data().count,
      aiRuns7d: aiTotal,
      aiFallbackPct: aiTotal ? Math.round((aiFallback / aiTotal) * 100) : 0,
      aiFallback24hPct: ai24 ? Math.round((aiFallback24 / ai24) * 100) : 0,
      aiFailed7d: aiFailed,
      payingEngaged7dPct: activeSubscriptionDocs.length ? Math.round((activeSubEngaged7d / activeSubscriptionDocs.length) * 100) : 0,
      atRiskCount: atRisk.length,
      errors24h
    },
    activity: { labels: Object.keys(byDay), meals: Object.values(byDay) },
    aiConfig,
    aiStats: aiByAgent,
    atRisk,
    expiringSoonList,
    expiredList,
    errorFeed: errorFeed.slice(0, 25),
    pending
  });
  } catch (error) {
    response.status(500).json({ ok: false, error: "monitoring-failed", message: error instanceof Error ? error.message : String(error) });
  }
});

// Deep drill-down for one user (admin drawer): profile, subscription, streak,
// total meals and the most recent meals. Uses the existing userId+loggedAt index.
export const getAdminUserDetail = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
  try { await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }
  try {
    const uid = String((request.body as { userId?: string } | undefined)?.userId ?? "").trim();
    if (!uid) { response.status(400).json({ ok: false, error: "missing-userId" }); return; }
    const [profileSnap, subSnap, mealCount, lastMealSnap] = await Promise.all([
      db.collection("profiles").doc(uid).get(),
      db.collection("subscriptions").doc(uid).get(),
      db.collection("mealLogs").where("userId", "==", uid).count().get(),
      db.collection("mealLogs").where("userId", "==", uid).orderBy("loggedAt", "desc").limit(1).get()
    ]);
    const profile = profileSnap.data() ?? {};
    const sub = subSnap.data() ?? {};
    const lifetime = isLifetimeSubscription(sub);
    // Privacy: return only aggregate engagement metadata for retention decisions,
    // never the customer's meal content or a link into their personal dashboard.
    const lastLogAt = lastMealSnap.docs[0] ? timestampToIso(lastMealSnap.docs[0].data().loggedAt) : null;
    response.json({
      ok: true,
      userId: uid,
      name: String(profile.displayName ?? "Member"),
      lineUserId: String(profile.lineUserId ?? uid),
      target: profile.target ?? null,
      streak: normalizeStreak(profile),
      subscription: { status: sub.status ?? null, expiresAt: lifetime ? null : timestampToIso(sub.expiresAt), lifetime },
      mealCount: mealCount.data().count,
      lastLogAt
    });
  } catch (error) {
    response.status(500).json({ ok: false, error: "user-detail-failed", message: error instanceof Error ? error.message : String(error) });
  }
});

// Full customer directory for the admin "all customers" tab: profile + current
// subscription + snapshot stats (first/last log, meal count) joined per user.
// Returns aggregate metadata only (no meal content). Searched/sorted client-side.
export const getAdminCustomers = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
  try { await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }
  try {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const [profilesSnap, subsSnap] = await Promise.all([
      db.collection("profiles").get(),
      db.collection("subscriptions").get()
    ]);
    const subs: Record<string, FirebaseFirestore.DocumentData> = {};
    subsSnap.forEach((doc) => { subs[doc.id] = doc.data(); });
    const customers = profilesSnap.docs.map((doc) => {
      const p = doc.data();
      if (!p.canonicalUserId && !p.userId && !p.displayName) return null;
      const sub = subs[doc.id] ?? {};
      const expiresAt = normalizeTimestamp(sub.expiresAt);
      const lifetime = isLifetimeSubscription(sub);
      const stats = (p.stats ?? {}) as Record<string, unknown>;
      const streak = (p.streak ?? {}) as Record<string, unknown>;
      return {
        canonicalUserId: doc.id,
        lineUserId: String(p.lineUserId ?? doc.id),
        name: String(p.displayName ?? "Member"),
        status: lifetime ? "lifetime" : (sub.status ?? null),
        lifetime,
        daysToExpiry: lifetime ? null : (expiresAt ? Math.round((expiresAt.toMillis() - now) / day) : null),
        expiresAt: lifetime ? null : timestampToIso(sub.expiresAt),
        streak: Math.max(0, Number(streak.count ?? 0)),
        firstLogAt: timestampToIso(stats.firstLogAt),
        lastLogAt: timestampToIso(stats.lastLogAt),
        mealCount: Math.max(0, Number(stats.mealCount ?? 0)),
        createdAt: timestampToIso(p.createdAt)
      };
    }).filter((x): x is NonNullable<typeof x> => x !== null);
    response.json({ ok: true, count: customers.length, customers });
  } catch (error) {
    response.status(500).json({ ok: false, error: "customers-failed", message: error instanceof Error ? error.message : String(error) });
  }
});

// Flip an AI agent's primary provider from the admin UI so
// the operator can route around a Gemini overload and switch back on recovery.
export const setAiPrimary = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
  let adminEmail: string;
  try { adminEmail = await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }
  try {
    const body = (request.body ?? {}) as { agentId?: string; primary?: string };
    const agentId = String(body.agentId ?? "");
    const primary = String(body.primary ?? "");
    if (!isAdminAiAgentId(agentId) || !["gemini", "anthropic"].includes(primary)) {
      response.status(400).json({ ok: false, error: "invalid-request" });
      return;
    }
    // BIA (InBody PDF) and coach payloads are heavier, so they need longer timeouts.
    const heavy = agentId === "biaAnalysis" || agentId === "coachConsultation";
    const DEFAULT_GEMINI = { provider: "gemini", model: "gemini-3.5-flash", timeoutMs: heavy ? 20000 : 12000 };
    const DEFAULT_ANTHROPIC = { provider: "anthropic", model: "claude-sonnet-4-6", timeoutMs: heavy ? 45000 : 20000 };
    const ref = db.collection("aiAgents").doc(agentId);
    const current = (await ref.get()).data() ?? {};
    const temp = Number(current.temperature ?? 0.2);
    const configured = [
      { provider: String(current.provider ?? ""), model: String(current.model ?? ""), timeoutMs: Number(current.timeoutMs) },
      ...(Array.isArray(current.fallbacks) ? current.fallbacks as Array<Record<string, unknown>> : []).map((item) => ({
        provider: String(item.provider ?? ""),
        model: String(item.model ?? ""),
        timeoutMs: Number(item.timeoutMs)
      }))
    ];
    const configuredFor = (provider: string) => configured.find((item) => item.provider === provider && normalizeAdminModelId(item.model));
    const primaryDefault = primary === "gemini" ? DEFAULT_GEMINI : DEFAULT_ANTHROPIC;
    const fallbackDefault = primary === "gemini" ? DEFAULT_ANTHROPIC : DEFAULT_GEMINI;
    const savedPrimary = configuredFor(primary);
    const savedFallback = configuredFor(fallbackDefault.provider);
    const primaryCfg = {
      ...primaryDefault,
      model: savedPrimary?.model ?? primaryDefault.model,
      timeoutMs: Number.isFinite(savedPrimary?.timeoutMs) && Number(savedPrimary?.timeoutMs) > 0 ? Number(savedPrimary?.timeoutMs) : primaryDefault.timeoutMs
    };
    const fallbackCfg = {
      ...fallbackDefault,
      model: savedFallback?.model ?? fallbackDefault.model,
      timeoutMs: Number.isFinite(savedFallback?.timeoutMs) && Number(savedFallback?.timeoutMs) > 0 ? Number(savedFallback?.timeoutMs) : fallbackDefault.timeoutMs
    };
    await ref.set({
      provider: primaryCfg.provider, model: primaryCfg.model, timeoutMs: primaryCfg.timeoutMs, maxAttempts: 1,
      fallbacks: [{ provider: fallbackCfg.provider, model: fallbackCfg.model, temperature: temp, timeoutMs: fallbackCfg.timeoutMs, maxAttempts: 1 }],
      updatedBy: `admin:${adminEmail}`, updatedAt: Timestamp.now()
    }, { merge: true });
    response.json({ ok: true, agentId, primary: primaryCfg.provider, model: primaryCfg.model, fallbackModel: fallbackCfg.model });
  } catch (error) {
    response.status(500).json({ ok: false, error: "set-ai-primary-failed", message: error instanceof Error ? error.message : String(error) });
  }
});

// Update model IDs without a deploy. Model names intentionally use validated
// free-text rather than a fixed dropdown because provider catalogs change often.
export const setAiAgentModels = onRequest(async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
  let adminEmail: string;
  try { adminEmail = await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }

  try {
    const body = (request.body ?? {}) as { agentId?: string; primaryModel?: string; fallbackModel?: string };
    const agentId = String(body.agentId ?? "");
    const primaryModel = normalizeAdminModelId(body.primaryModel);
    const fallbackModel = body.fallbackModel === undefined ? null : normalizeAdminModelId(body.fallbackModel);
    if (!isAdminAiAgentId(agentId) || !primaryModel || (body.fallbackModel !== undefined && !fallbackModel)) {
      response.status(400).json({ ok: false, error: "invalid-model-config", message: "Model ID must be 2-120 characters and contain only letters, numbers, dot, underscore, colon, or hyphen." });
      return;
    }

    const ref = db.collection("aiAgents").doc(agentId);
    const snap = await ref.get();
    if (!snap.exists) { response.status(404).json({ ok: false, error: "ai-agent-not-found" }); return; }
    const current = snap.data() ?? {};
    const fallbacks = Array.isArray(current.fallbacks)
      ? current.fallbacks.map((item) => ({ ...(item as Record<string, unknown>) }))
      : [];
    if (fallbackModel) {
      if (!fallbacks[0]) { response.status(400).json({ ok: false, error: "fallback-not-configured" }); return; }
      fallbacks[0].model = fallbackModel;
    }

    const updatedAt = Timestamp.now();
    const update: Record<string, unknown> = {
      model: primaryModel,
      updatedBy: `admin:${adminEmail}`,
      updatedAt
    };
    if (fallbacks.length) update.fallbacks = fallbacks;
    const auditRef = db.collection("adminAuditLogs").doc();
    const batch = db.batch();
    batch.set(ref, update, { merge: true });
    batch.set(auditRef, {
      type: "ai-agent-model-update",
      status: "success",
      agentId,
      provider: String(current.provider ?? ""),
      previousModel: String(current.model ?? ""),
      model: primaryModel,
      fallbackModel: fallbackModel ?? null,
      adminEmail,
      createdAt: updatedAt
    });
    await batch.commit();

    response.json({ ok: true, agentId, model: primaryModel, fallbackModel: fallbackModel ?? null });
  } catch (error) {
    response.status(500).json({ ok: false, error: "set-ai-agent-models-failed", message: error instanceof Error ? error.message : String(error) });
  }
});

// Validate draft model IDs against the real provider APIs without changing
// Firestore. The admin UI requires this canary to pass before enabling Save.
export const testAiAgentModels = onRequest(
  { secrets: AI_PROVIDER_SECRETS, timeoutSeconds: 30 },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
    try { await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }

    try {
      const body = (request.body ?? {}) as { agentId?: string; primaryModel?: string; fallbackModel?: string };
      const agentId = String(body.agentId ?? "");
      const primaryModel = normalizeAdminModelId(body.primaryModel);
      const fallbackModel = body.fallbackModel === undefined ? null : normalizeAdminModelId(body.fallbackModel);
      if (!isAdminAiAgentId(agentId) || !primaryModel || (body.fallbackModel !== undefined && !fallbackModel)) {
        response.status(400).json({ ok: false, error: "invalid-model-config" });
        return;
      }

      const snap = await db.collection("aiAgents").doc(agentId).get();
      if (!snap.exists) { response.status(404).json({ ok: false, error: "ai-agent-not-found" }); return; }
      const current = snap.data() ?? {};
      const fallback = Array.isArray(current.fallbacks) && current.fallbacks[0]
        ? current.fallbacks[0] as Record<string, unknown>
        : null;
      const candidates = [
        { role: "primary", provider: String(current.provider ?? ""), model: primaryModel },
        ...(fallbackModel && fallback ? [{ role: "fallback", provider: String(fallback.provider ?? ""), model: fallbackModel }] : [])
      ];
      if (candidates.some((item) => item.provider !== "gemini" && item.provider !== "anthropic")) {
        response.status(400).json({ ok: false, error: "unsupported-provider" });
        return;
      }

      const results = await Promise.all(candidates.map(async (candidate) => {
        const startedAt = Date.now();
        try {
          const res = candidate.provider === "gemini"
            ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${candidate.model}:generateContent?key=${GEMINI_API_KEY.value()}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 5 } })
              })
            : await fetch("https://api.anthropic.com/v1/messages", {
                method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY.value(), "anthropic-version": "2023-06-01" },
                body: JSON.stringify({ model: candidate.model, max_tokens: 5, messages: [{ role: "user", content: "ping" }] })
              });
          if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).replace(/\s+/g, " ").slice(0, 140)}`);
          return { ...candidate, ok: true, ms: Date.now() - startedAt, error: null as string | null };
        } catch (error) {
          return { ...candidate, ok: false, ms: Date.now() - startedAt, error: (error instanceof Error ? error.message : String(error)).slice(0, 220) };
        }
      }));

      response.json({ ok: true, agentId, allPassed: results.every((item) => item.ok), results });
    } catch (error) {
      response.status(500).json({ ok: false, error: "test-ai-agent-models-failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
);

// Live provider health probe: ping Gemini and Anthropic with a tiny request so
// the operator can see, in real time, whether Gemini has recovered from an
// outage (it's the fallback now, so the dashboard fallback% no longer reflects
// its health). Returns each provider's ok/latency/error.
export const testAiProvider = onRequest(
  { secrets: AI_PROVIDER_SECRETS, timeoutSeconds: 30 },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
    try { await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }

    const probe = async (fn: () => Promise<void>) => {
      const t0 = Date.now();
      try { await fn(); return { ok: true, ms: Date.now() - t0, error: null as string | null }; }
      catch (error) { return { ok: false, ms: Date.now() - t0, error: (error instanceof Error ? error.message : String(error)).slice(0, 220) }; }
    };

    const candidates = new Map<string, { provider: "gemini" | "anthropic"; model: string }>();
    const aiAgentsSnap = await db.collection("aiAgents").get();
    aiAgentsSnap.forEach((doc) => {
      const data = doc.data();
      const configs = [data, ...(Array.isArray(data.fallbacks) ? data.fallbacks : [])];
      configs.forEach((item) => {
        const provider = String(item?.provider ?? "");
        const model = normalizeAdminModelId(item?.model);
        if ((provider === "gemini" || provider === "anthropic") && model) {
          candidates.set(`${provider}:${model}`, { provider, model });
        }
      });
    });
    if (![...candidates.values()].some((item) => item.provider === "gemini")) {
      candidates.set("gemini:gemini-3.5-flash", { provider: "gemini", model: "gemini-3.5-flash" });
    }
    if (![...candidates.values()].some((item) => item.provider === "anthropic")) {
      candidates.set("anthropic:claude-sonnet-4-6", { provider: "anthropic", model: "claude-sonnet-4-6" });
    }

    const results = await Promise.all([...candidates.values()].map(async (candidate) => ({
      ...candidate,
      ...(await probe(async () => {
        const res = candidate.provider === "gemini"
          ? await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${candidate.model}:generateContent?key=${GEMINI_API_KEY.value()}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ contents: [{ parts: [{ text: "ping" }] }], generationConfig: { maxOutputTokens: 5 } })
            })
          : await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST", headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY.value(), "anthropic-version": "2023-06-01" },
              body: JSON.stringify({ model: candidate.model, max_tokens: 5, messages: [{ role: "user", content: "ping" }] })
            });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).replace(/\s+/g, " ").slice(0, 140)}`);
      }))
    })));

    response.json({ ok: true, testedAt: new Date().toISOString(), results });
  }
);

// Retention/sales action: gift extra days or a lifetime/VIP grant to a customer
// from the admin UI and notify them on LINE. Recorded as an admin-grant event
// (no payment), distinct from slip approvals.
export const grantSubscriptionFromAdmin = onRequest(
  { secrets: [LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID], timeoutSeconds: 30 },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
    let adminEmail: string;
    try { adminEmail = await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }
    try {
      const body = (request.body ?? {}) as { userId?: string; days?: number; lifetime?: boolean };
      const uid = String(body.userId ?? "").trim();
      const lifetime = Boolean(body.lifetime);
      const days = Math.max(0, Math.min(3650, Math.floor(Number(body.days ?? 0))));
      if (!uid || (!lifetime && days <= 0)) { response.status(400).json({ ok: false, error: "invalid-request" }); return; }

      const target = await resolveSubscriptionTarget(uid);
      if (!target) { response.status(404).json({ ok: false, error: "target-not-found" }); return; }

      const currentExpiry = await getSubscriptionExpiry(target.canonicalUserId);
      const expiresAt = lifetime ? null : subscriptionExpiryAfterDays(days, currentExpiry);
      const now = Timestamp.now();
      await Promise.all([
        db.collection("subscriptions").doc(target.canonicalUserId).set({
          userId: target.canonicalUserId, canonicalUserId: target.canonicalUserId,
          status: "active", entitlementType: lifetime ? "lifetime" : "gift", lifetime, expiresAt,
          lastApprovedDays: lifetime ? null : days, lastApprovedBy: `admin:${adminEmail}`, lastApprovedAt: now, updatedAt: now
        }, { merge: true }),
        db.collection("profiles").doc(target.canonicalUserId).set({ expiresAt, lifetime, updatedAt: now }, { merge: true }),
        db.collection("subscriptionEvents").add({
          type: "admin-grant", canonicalUserId: target.canonicalUserId, lineUserId: target.lineUserId,
          days: lifetime ? null : days, lifetime, grantedBy: `admin:${adminEmail}`, createdAt: now
        })
      ]);

      if (target.lineUserId) {
        const giftMessage = lifetime
          ? "👑 ทีมงาน MyDietitian มอบสิทธิ์ VIP Lifetime ให้คุณเป็นพิเศษ! ใช้งานได้ไม่มีวันหมดอายุครับ ขอบคุณที่ไว้วางใจเรา 💚"
          : `🎁 ทีมงาน MyDietitian มอบเวลาใช้งานเพิ่ม ${days} วันให้คุณ!\nหมดอายุใหม่: ${formatSubscriptionStatus(expiresAt)}\nขอบคุณที่อยู่กับเรานะครับ 💚`;
        await pushMessage(target.lineUserId, giftMessage);
      }
      response.json({ ok: true, userId: target.canonicalUserId, lifetime, expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null });
    } catch (error) {
      response.status(500).json({ ok: false, error: "grant-failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
);

// Admin-initiated LINE push to a list of users (win-back / retention campaign).
// Body: { userIds: string[], message: string, promoDays?: number }
// If promoDays > 0, grants subscription extension first then appends promo line to message.
// Returns: { ok, sent, failed, skipped }
export const adminPushToUsers = onRequest(
  { secrets: [LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID], timeoutSeconds: 120 },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") { response.status(405).json({ ok: false, error: "method-not-allowed" }); return; }
    let adminEmail: string;
    try { adminEmail = await requireAdminEmail(request); } catch { response.status(401).json({ ok: false, error: "admin-auth-failed" }); return; }
    try {
      const body = (request.body ?? {}) as { userIds?: string[]; message?: string; promoDays?: number };
      const userIds: string[] = Array.isArray(body.userIds) ? body.userIds.map(String).filter(Boolean) : [];
      const message = String(body.message ?? "").trim();
      const promoDays = Math.max(0, Math.min(365, Math.floor(Number(body.promoDays ?? 0))));
      if (!userIds.length || !message) { response.status(400).json({ ok: false, error: "invalid-request" }); return; }
      if (userIds.length > 100) { response.status(400).json({ ok: false, error: "too-many-users", max: 100 }); return; }

      const now = Timestamp.now();
      let sent = 0, failed = 0, skipped = 0;
      for (const uid of userIds) {
        const target = await resolveSubscriptionTarget(uid).catch(() => null);
        if (!target?.lineUserId) { skipped++; continue; }
        try {
          let finalMessage = message;
          if (promoDays > 0) {
            const currentExpiry = await getSubscriptionExpiry(target.canonicalUserId);
            const expiresAt = subscriptionExpiryAfterDays(promoDays, currentExpiry);
            await Promise.all([
              db.collection("subscriptions").doc(target.canonicalUserId).set({
                userId: target.canonicalUserId, canonicalUserId: target.canonicalUserId,
                status: "active", entitlementType: "promo", lifetime: false, expiresAt,
                lastApprovedDays: promoDays, lastApprovedBy: `admin:${adminEmail}`, lastApprovedAt: now, updatedAt: now
              }, { merge: true }),
              db.collection("profiles").doc(target.canonicalUserId).set({ expiresAt, updatedAt: now }, { merge: true }),
              db.collection("subscriptionEvents").add({
                type: "admin-promo", canonicalUserId: target.canonicalUserId, lineUserId: target.lineUserId,
                days: promoDays, grantedBy: `admin:${adminEmail}`, createdAt: now
              })
            ]);
            finalMessage = `${message}\n\n🎁 ทีมงานมอบเวลาใช้งานเพิ่ม ${promoDays} วันให้คุณโดยอัตโนมัติแล้ว!\nหมดอายุใหม่: ${formatSubscriptionStatus(expiresAt)} 💚`;
          }
          await pushMessage(target.lineUserId, finalMessage);
          sent++;
        } catch {
          failed++;
        }
      }
      response.json({ ok: true, sent, failed, skipped, promoDays });
    } catch (error) {
      response.status(500).json({ ok: false, error: "push-failed", message: error instanceof Error ? error.message : String(error) });
    }
  }
);

export const getSupportTickets = onRequest({ invoker: "public" }, async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  try {
    await requireAdminEmail(request);
  } catch {
    response.status(401).json({ ok: false, error: "admin-auth-failed" });
    return;
  }

  try {
    const snap = await db.collection("supportTickets")
      .orderBy("lastMessageAt", "desc")
      .limit(100)
      .get();
    const tickets = snap.docs.map((doc) => {
      const data = doc.data();
      return {
        ticketId: doc.id,
        canonicalUserId: String(data.canonicalUserId ?? ""),
        lineUserId: String(data.lineUserId ?? ""),
        displayName: String(data.displayName ?? "Member"),
        status: String(data.status ?? "open"),
        state: String(data.state ?? "waiting-admin"),
        unreadAdmin: Math.max(0, Number(data.unreadAdmin ?? 0)),
        messageCount: Math.max(0, Number(data.messageCount ?? 0)),
        lastMessageText: String(data.lastMessageText ?? ""),
        lastMessageDirection: String(data.lastMessageDirection ?? ""),
        lastMessageAt: timestampToIso(data.lastMessageAt),
        openedAt: timestampToIso(data.openedAt),
        closedAt: timestampToIso(data.closedAt)
      };
    });
    response.json({
      ok: true,
      openCount: tickets.filter((ticket) => ticket.status === "open").length,
      unreadCount: tickets.reduce((sum, ticket) => sum + ticket.unreadAdmin, 0),
      tickets
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: "support-tickets-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const getSupportThread = onRequest({ invoker: "public" }, async (request, response) => {
  if (handleCorsPreflight(request, response)) return;
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }
  let adminEmail: string;
  try {
    adminEmail = await requireAdminEmail(request);
  } catch {
    response.status(401).json({ ok: false, error: "admin-auth-failed" });
    return;
  }

  try {
    const ticketId = String((request.body as { ticketId?: string } | undefined)?.ticketId ?? "").trim();
    if (!isSafePublicId(ticketId)) {
      response.status(400).json({ ok: false, error: "invalid-ticket-id" });
      return;
    }
    const ticketRef = db.collection("supportTickets").doc(ticketId);
    const [ticketSnap, messagesSnap] = await Promise.all([
      ticketRef.get(),
      ticketRef.collection("messages").orderBy("createdAt", "asc").limit(250).get()
    ]);
    if (!ticketSnap.exists) {
      response.status(404).json({ ok: false, error: "ticket-not-found" });
      return;
    }
    const data = ticketSnap.data() ?? {};
    if (Number(data.unreadAdmin ?? 0) > 0) {
      await ticketRef.set({
        unreadAdmin: 0,
        lastReadByAdmin: adminEmail,
        lastReadAt: Timestamp.now()
      }, { merge: true });
    }
    response.json({
      ok: true,
      ticket: {
        ticketId,
        canonicalUserId: String(data.canonicalUserId ?? ""),
        lineUserId: String(data.lineUserId ?? ""),
        displayName: String(data.displayName ?? "Member"),
        status: String(data.status ?? "open"),
        state: String(data.state ?? "waiting-admin"),
        messageCount: Math.max(0, Number(data.messageCount ?? messagesSnap.size)),
        openedAt: timestampToIso(data.openedAt),
        closedAt: timestampToIso(data.closedAt)
      },
      messages: messagesSnap.docs.map((doc) => {
        const message = doc.data();
        return {
          messageId: doc.id,
          direction: String(message.direction ?? ""),
          senderType: String(message.senderType ?? ""),
          senderLabel: String(message.senderLabel ?? ""),
          text: String(message.text ?? ""),
          deliveryStatus: String(message.deliveryStatus ?? "delivered"),
          createdAt: timestampToIso(message.createdAt)
        };
      })
    });
  } catch (error) {
    response.status(500).json({
      ok: false,
      error: "support-thread-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const replySupportTicket = onRequest(
  { secrets: [LINE_CHANNEL_ACCESS_TOKEN], timeoutSeconds: 60, invoker: "public" },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }
    let adminEmail: string;
    try {
      adminEmail = await requireAdminEmail(request);
    } catch {
      response.status(401).json({ ok: false, error: "admin-auth-failed" });
      return;
    }

    try {
      const body = (request.body ?? {}) as { ticketId?: string; message?: string };
      const ticketId = String(body.ticketId ?? "").trim();
      const message = normalizeSupportText(body.message, 2000);
      if (!isSafePublicId(ticketId) || !message) {
        response.status(400).json({ ok: false, error: "invalid-support-reply" });
        return;
      }
      const ticketRef = db.collection("supportTickets").doc(ticketId);
      const ticketSnap = await ticketRef.get();
      const ticket = ticketSnap.data() ?? {};
      if (!ticketSnap.exists) {
        response.status(404).json({ ok: false, error: "ticket-not-found" });
        return;
      }
      if (ticket.status !== "open") {
        response.status(409).json({ ok: false, error: "ticket-closed" });
        return;
      }
      const lineUserId = String(ticket.lineUserId ?? "");
      if (!lineUserId) {
        response.status(409).json({ ok: false, error: "ticket-has-no-line-user" });
        return;
      }

      await pushMessages(lineUserId, [buildSupportReplyMessage(ticketId, message)]);
      const now = Timestamp.now();
      const messageRef = ticketRef.collection("messages").doc();
      const batch = db.batch();
      batch.set(messageRef, {
        messageId: messageRef.id,
        direction: "admin-to-customer",
        senderType: "admin",
        senderLabel: adminEmail,
        text: message,
        deliveryStatus: "delivered",
        deliveredAt: now,
        createdAt: now
      });
      batch.set(ticketRef, {
        status: "open" satisfies SupportTicketStatus,
        state: "waiting-customer" satisfies SupportTicketState,
        unreadAdmin: 0,
        lastMessageText: message,
        lastMessageDirection: "admin-to-customer",
        lastMessageAt: now,
        lastAdminReplyAt: now,
        lastAdminEmail: adminEmail,
        messageCount: FieldValue.increment(1),
        updatedAt: now
      }, { merge: true });
      batch.set(db.collection("adminAuditLogs").doc(), {
        type: "support-ticket-replied",
        ticketId,
        canonicalUserId: String(ticket.canonicalUserId ?? ""),
        adminEmail,
        createdAt: now
      });
      await batch.commit();
      response.json({ ok: true, ticketId, messageId: messageRef.id, state: "waiting-customer" });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: "support-reply-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
);

export const closeSupportTicket = onRequest(
  { secrets: [LINE_CHANNEL_ACCESS_TOKEN], timeoutSeconds: 60, invoker: "public" },
  async (request, response) => {
    if (handleCorsPreflight(request, response)) return;
    if (request.method !== "POST") {
      response.status(405).json({ ok: false, error: "method-not-allowed" });
      return;
    }
    let adminEmail: string;
    try {
      adminEmail = await requireAdminEmail(request);
    } catch {
      response.status(401).json({ ok: false, error: "admin-auth-failed" });
      return;
    }

    try {
      const ticketId = String((request.body as { ticketId?: string } | undefined)?.ticketId ?? "").trim();
      if (!isSafePublicId(ticketId)) {
        response.status(400).json({ ok: false, error: "invalid-ticket-id" });
        return;
      }
      const ticketRef = db.collection("supportTickets").doc(ticketId);
      const ticketSnap = await ticketRef.get();
      if (!ticketSnap.exists) {
        response.status(404).json({ ok: false, error: "ticket-not-found" });
        return;
      }
      const ticket = ticketSnap.data() ?? {};
      if (ticket.status === "closed") {
        response.json({ ok: true, ticketId, alreadyClosed: true });
        return;
      }

      const canonicalUserId = String(ticket.canonicalUserId ?? "");
      if (!canonicalUserId) {
        response.status(409).json({ ok: false, error: "ticket-has-no-canonical-user" });
        return;
      }
      const now = Timestamp.now();
      const pointerRef = db.collection("supportTicketPointers").doc(canonicalUserId);
      const systemMessageRef = ticketRef.collection("messages").doc();
      const auditRef = db.collection("adminAuditLogs").doc();
      await db.runTransaction(async (transaction) => {
        const pointerSnap = await transaction.get(pointerRef);
        transaction.set(ticketRef, {
          status: "closed" satisfies SupportTicketStatus,
          state: "closed" satisfies SupportTicketState,
          unreadAdmin: 0,
          messageCount: FieldValue.increment(1),
          closedAt: now,
          closedBy: adminEmail,
          updatedAt: now
        }, { merge: true });
        transaction.set(systemMessageRef, {
          messageId: systemMessageRef.id,
          direction: "system",
          senderType: "system",
          senderLabel: "MyDietitian",
          text: "ปิดเคสแล้ว",
          deliveryStatus: "delivered",
          createdAt: now
        });
        transaction.set(auditRef, {
          type: "support-ticket-closed",
          ticketId,
          canonicalUserId,
          adminEmail,
          createdAt: now
        });
        if (pointerSnap.exists && pointerSnap.data()?.activeTicketId === ticketId) {
          transaction.delete(pointerRef);
        }
      });

      let customerNotified = false;
      const lineUserId = String(ticket.lineUserId ?? "");
      if (lineUserId) {
        try {
          await pushMessage(lineUserId, "ทีมงานปิดเคสนี้แล้วครับ หากต้องการความช่วยเหลือเพิ่มเติม พิมพ์ `แอดมิน` ตามด้วยข้อความเพื่อเปิดเคสใหม่ได้เลย");
          customerNotified = true;
        } catch {
          customerNotified = false;
        }
      }
      response.json({ ok: true, ticketId, customerNotified });
    } catch (error) {
      response.status(500).json({
        ok: false,
        error: "support-close-failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
);

// Proactive reliability alert: every 30 min, if failures spike, push a LINE
// message to the admin (throttled so a sustained outage alerts once per hour).
// Fires on genuine failures only (status=failed / error-tagged audit logs), not
// Gemini->Anthropic fallbacks, which recover and complete normally.
export const errorAlertScheduler = onSchedule(
  { schedule: "every 30 minutes", secrets: [LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID], timeoutSeconds: 60 },
  async () => {
    const since = Timestamp.fromMillis(Date.now() - 35 * 60 * 1000);
    const [aiSnap, auditSnap] = await Promise.all([
      db.collection("aiRuns").where("createdAt", ">=", since).get(),
      db.collection("adminAuditLogs").where("createdAt", ">=", since).get()
    ]);

    let aiFailed = 0;
    aiSnap.forEach((doc) => { if (doc.data().status === "failed") aiFailed += 1; });

    let auditErrors = 0;
    const samples: string[] = [];
    auditSnap.forEach((doc) => {
      const data = doc.data();
      const tag = `${data.type ?? ""}/${data.status ?? ""}`;
      if (!/error|fail|reject|unhandled/i.test(tag)) return;
      auditErrors += 1;
      if (samples.length < 3) samples.push(String(data.type ?? tag));
    });

    const total = aiFailed + auditErrors;
    if (total < 3) return;

    const stateRef = db.collection("appConfig").doc("alertState");
    const lastAlertMs = Number((await stateRef.get()).data()?.lastErrorAlertMs ?? 0);
    if (Date.now() - lastAlertMs < 50 * 60 * 1000) return;
    await stateRef.set({ lastErrorAlertMs: Date.now() }, { merge: true });

    const lines = [
      "🚨 MyDietitian alert",
      `Error ${total} รายการใน 30 นาที (AI fail ${aiFailed}, อื่นๆ ${auditErrors})`,
      ...(samples.length ? [`• ${samples.join("\n• ")}`] : []),
      "เปิด admin: https://mydietitian.web.app/admin"
    ];
    await pushMessage(ADMIN_LINE_USER_ID.value(), lines.join("\n"));
  }
);

// Daily tick that advances weekly CUT/Bulk programs: when a user crosses into a
// new week it pushes the new target via LINE, and when the program's weeks are
// up it marks the plan completed and prompts the user to set up what's next.
// Boundary is compared by whole weeks (not exact %7), so a missed run catches
// up instead of skipping a week's notification.
export const weeklyProgramTick = onSchedule(
  { schedule: "30 8 * * *", timeZone: "Asia/Bangkok", secrets: [LINE_CHANNEL_ACCESS_TOKEN], timeoutSeconds: 300 },
  async () => {
    const snap = await db.collection("profiles").where("program.status", "==", "active").get();
    if (snap.empty) return;

    const appConfig = await getAppRuntimeConfig();
    const todayYmd = bangkokDateString(new Date());

    for (const doc of snap.docs) {
      try {
        const profile = doc.data() ?? {};
        const program = normalizeProgram(profile);
        if (!program) continue;

        const lineUserId = typeof profile.lineUserId === "string" ? profile.lineUserId : "";
        const diffDays = daysBetweenDateStrings(program.startDate, todayYmd);
        if (diffDays <= 0) continue; // program hasn't started advancing yet

        const programState = (profile.program ?? {}) as Record<string, unknown>;
        const lastNotifiedWeek = Number(programState.lastNotifiedWeek ?? 1);
        const now = Timestamp.now();

        if (diffDays >= program.weeks * 7) {
          // Whole plan elapsed: revert to the baseline target and ask what's next.
          if (lineUserId) {
            const link = `${appConfig.liffSettingsUrl}&uid=${encodeURIComponent(lineUserId)}`;
            await pushMessage(lineUserId, [
              `🎉 จบโปรแกรม ${program.type === "cut" ? "CUT" : "Bulk"} ครบ ${program.weeks} สัปดาห์แล้วครับ!`,
              `ตอนนี้กลับมาใช้เป้าหมายตั้งต้น ${program.baseline.calories} kcal`,
              "จะต่อโปรแกรมใหม่ ปรับเป้าหมาย หรือเข้าสู่ช่วง maintain — ตั้งค่าที่นี่ครับ:",
              link
            ].join("\n"));
          }
          await doc.ref.set(
            { program: { status: "completed", completedAt: now, updatedAt: now }, updatedAt: now },
            { merge: true }
          );
          continue;
        }

        const currentWeek = Math.min(Math.floor(diffDays / 7) + 1, program.weeks);
        if (currentWeek <= lastNotifiedWeek) continue; // already announced this week

        if (lineUserId) {
          const wk = applyProgramWeek(program.baseline, program, currentWeek - 1);
          const macroLabel = PROGRAM_MACRO_LABEL_TH[program.adjustMacro];
          const macroG = program.adjustMacro === "fat" ? wk.fatG : program.adjustMacro === "protein" ? wk.proteinG : wk.carbsG;
          await pushMessage(lineUserId, [
            `📅 เข้าสัปดาห์ที่ ${currentWeek}/${program.weeks} ของโปรแกรม ${program.type === "cut" ? "CUT" : "Bulk"} แล้วครับ`,
            `เป้าหมายวันนี้: ${wk.calories} kcal`,
            `${macroLabel} ${macroG} g • โปรตีน ${wk.proteinG} g • ไขมัน ${wk.fatG} g`
          ].join("\n"));
        }
        await doc.ref.set(
          { program: { lastNotifiedWeek: currentWeek, updatedAt: now }, updatedAt: now },
          { merge: true }
        );
      } catch (error) {
        console.error("weeklyProgramTick failed for", doc.id, error);
      }
    }
  }
);

export const analyzeMeal = onRequest({ secrets: AI_PROVIDER_SECRETS }, async (request, response) => {
  if (handleCorsPreflight(request, response)) return;

  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const body = request.body as AnalyzeMealRequest;
  if (!body?.userId || !body?.source || !body?.inputType) {
    response.status(400).json({ ok: false, error: "invalid-request" });
    return;
  }

  let loggedAtDayKey: string | undefined;
  if (body.loggedAtDayKey) {
    const validation = validateLoggedAtDayKey(String(body.loggedAtDayKey));
    if (!validation.ok) {
      response.status(400).json({
        ok: false,
        error: validation.error,
        message: validation.error === "future-day-not-allowed"
          ? "ไม่สามารถบันทึกมื้อในวันอนาคตได้"
          : validation.error === "day-too-old"
            ? "บันทึกย้อนหลังได้ไม่เกิน 14 วัน"
            : "รูปแบบวันที่ไม่ถูกต้อง (ใช้ YYYY-MM-DD)"
      });
      return;
    }
    loggedAtDayKey = validation.dayKey;
  }

  try {
    const owner = await requireVerifiedProfileOwner(request, profileIdentityFromRequestBody(body));
    const canonicalUserId = owner.canonicalUserId;
    const readiness = await getUserReadiness(canonicalUserId);
    if (sendReadinessGate(response, readiness)) return;
    const saved = await analyzeAndSaveMeal({
      ...body,
      canonicalUserId,
      userId: canonicalUserId,
      loggedAtDayKey
    });
    // The chat's backdate card links here; once the user logs through the page,
    // the pending chat intent must not capture their next real-time meal.
    if (loggedAtDayKey) await clearBackdateIntent(canonicalUserId);
    // A meal logged from the LIFF day picker has no chat reply of its own, so
    // push the usual meal card (that day's totals + edit/leftover/delete
    // buttons) to the user's LINE chat.
    // Only the token-verified LINE id: body.lineUserId is caller-supplied and
    // would let a request push someone's meal card to another chat.
    const pushLineUserId = owner.lineUserId;
    const cardPushed = loggedAtDayKey && pushLineUserId
      ? await pushRefreshedMealCard(canonicalUserId, pushLineUserId, saved.mealLogId)
      : false;

    response.json({
      ok: true,
      canonicalUserId,
      runId: saved.runId,
      mealLogId: saved.mealLogId,
      analysis: saved.mealLog,
      cardPushed
    });
  } catch (error) {
    if (error instanceof ProfileAuthError) {
      sendProfileAuthError(response, error);
      return;
    }
    if (error instanceof MealImageUnclearError) {
      response.status(422).json({
        ok: false,
        error: "meal-image-unclear",
        message: error.message
      });
      return;
    }
    response.status(500).json({
      ok: false,
      error: "meal-analysis-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const analyzeExercise = onRequest({ secrets: AI_PROVIDER_SECRETS }, async (request, response) => {
  if (handleCorsPreflight(request, response)) return;

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
    const owner = await requireVerifiedProfileOwner(request, profileIdentityFromRequestBody(body));
    const canonicalUserId = owner.canonicalUserId;
    const readiness = await getUserReadiness(canonicalUserId);
    if (sendReadinessGate(response, readiness)) return;
    const saved = await analyzeAndSaveExercise({ ...body, canonicalUserId, userId: canonicalUserId });

    response.json({
      ok: true,
      canonicalUserId,
      runId: saved.runId,
      exerciseLogId: saved.exerciseLogId,
      analysis: saved.exerciseLog
    });
  } catch (error) {
    if (error instanceof ProfileAuthError) {
      sendProfileAuthError(response, error);
      return;
    }
    response.status(500).json({
      ok: false,
      error: "exercise-analysis-failed",
      message: error instanceof Error ? error.message : String(error)
    });
  }
});

export const lineWebhook = onRequest(
  { secrets: [LINE_CHANNEL_SECRET, LINE_CHANNEL_ACCESS_TOKEN, ADMIN_LINE_USER_ID, ...AI_PROVIDER_SECRETS], timeoutSeconds: 120 },
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
  if (isLineWebhookContractDryRun(request)) {
    const contract = buildLineWebhookContractDryRun(payload);
    response.status(contract.ok ? 200 : 400).json(contract);
    return;
  }

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

function isLineWebhookContractDryRun(request: Parameters<Parameters<typeof onRequest>[0]>[0]): boolean {
  return /^(1|true|yes)$/i.test(String(request.get("x-mydietitian-line-dry-run") ?? ""));
}

function buildLineWebhookContractDryRun(payload: LineWebhookEvent) {
  const events = Array.isArray(payload?.events) ? payload.events : [];
  const failures: string[] = [];

  if (!Array.isArray(payload?.events)) {
    failures.push("events must be an array");
  }
  if (events.length === 0) {
    failures.push("events must include at least one event");
  }

  const eventResults = events.map((event, index) => {
    const eventFailures: string[] = [];
    const messageType = event.message?.type ?? null;

    if (!event.type) eventFailures.push("event.type is required");
    if (!event.source?.userId) eventFailures.push("event.source.userId is required");
    if ((event.type === "follow" || event.type === "message") && !event.replyToken) {
      eventFailures.push("replyToken is required for follow/message events");
    }
    if (event.type === "message") {
      if (!event.message?.id) eventFailures.push("message.id is required");
      if (!messageType) eventFailures.push("message.type is required");
      if (messageType === "text" && !event.message?.text) {
        eventFailures.push("message.text is required for text messages");
      }
      if (messageType && !["text", "image", "file"].includes(messageType)) {
        eventFailures.push(`unsupported message.type for staging contract: ${messageType}`);
      }
    }

    if (event.type && !["follow", "message"].includes(event.type)) {
      eventFailures.push(`unsupported event.type for staging contract: ${event.type}`);
    }

    for (const failure of eventFailures) {
      failures.push(`events[${index}]: ${failure}`);
    }

    return {
      index,
      ok: eventFailures.length === 0,
      eventType: event.type ?? null,
      messageType,
      sourceType: event.source?.type ?? null,
      hasUserId: Boolean(event.source?.userId),
      hasReplyToken: Boolean(event.replyToken),
      failures: eventFailures
    };
  });

  return {
    ok: failures.length === 0,
    mode: "line-webhook-contract-dry-run",
    received: events.length,
    results: eventResults,
    failures,
    status: "signature-and-payload-contract-verified",
    warning: "Dry-run mode verifies the LINE signature and payload shape only; it does not write Firestore data or send LINE replies."
  };
}

function verifyLineSignature(rawBody: Buffer, signature: string): boolean {
  if (!signature) return false;

  const digest = createHmac("sha256", LINE_CHANNEL_SECRET.value())
    .update(rawBody)
    .digest("base64");

  const expected = Buffer.from(digest);
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function getAiProviderApiKeys() {
  return {
    gemini: GEMINI_API_KEY.value(),
    anthropic: ANTHROPIC_API_KEY.value()
  };
}

function didUseAiFallback(
  agent: { provider: string; model: string },
  primaryProvider: string,
  primaryModel: string
): boolean {
  return agent.provider !== primaryProvider || agent.model !== primaryModel;
}

async function analyzeAndSaveMeal(
  request: AnalyzeMealRequest,
  existingMeal?: MealLogSnapshot
): Promise<SavedMealAnalysis> {
  const now = Timestamp.now();
  const aiRunRef = db.collection("aiRuns").doc();
  const agent = await getAiAgentConfig("mealAnalysis");
  if (!agent.enabled) {
    throw new Error("AI mealAnalysis agent is disabled");
  }
  const primaryProvider = agent.provider;
  const primaryModel = agent.model;

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
    const analysis = await callGeminiMealAnalysis(request, getAiProviderApiKeys(), agent);
    const fallbackUsed = didUseAiFallback(agent, primaryProvider, primaryModel);
    const existingData = existingMeal?.data() ?? {};
    const mealLogRef = existingMeal?.ref ?? db.collection("mealLogs").doc();
    const savedAt = Timestamp.now();
    const resolvedDay = resolveMealLoggedAt(request.loggedAtDayKey, savedAt.toDate());
    const loggedAt = existingData.loggedAt ?? resolvedDay.loggedAt;
    const isBackdated = Boolean(existingData.backdated) || resolvedDay.isBackdated;
    const intendedDayKey = existingData.intendedDayKey
      ? String(existingData.intendedDayKey)
      : resolvedDay.dayKey;

    const mealLog: Record<string, unknown> = {
      userId: existingData.userId ?? request.userId,
      canonicalUserId: existingData.canonicalUserId ?? request.canonicalUserId ?? request.userId,
      source: existingData.source ?? request.source,
      inputType: request.inputType,
      text: request.text ?? null,
      imageUrl: request.imageUrl ?? existingData.imageUrl ?? null,
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
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        promptVersion: agent.promptVersion,
        fallbackUsed
      },
      loggedAt,
      createdAt: existingData.createdAt ?? savedAt,
      updatedAt: savedAt
    };
    if (isBackdated) {
      mealLog.backdated = true;
      mealLog.intendedDayKey = intendedDayKey;
    }

    // Re-analysing a saved meal must retain its identity and timestamp. In
    // particular, editing or backdating a historical entry must never advance
    // (or reset) today's streak.
    const canonicalUserId = request.canonicalUserId ?? request.userId;
    let streak: ReturnType<typeof normalizeStreak> | Awaited<ReturnType<typeof updateMealStreak>>;
    if (existingMeal) {
      streak = normalizeStreak(existingData);
    } else if (isBackdated) {
      streak = await readProfileStreak(canonicalUserId);
    } else {
      streak = await updateMealStreak(canonicalUserId, loggedAt instanceof Timestamp ? loggedAt : Timestamp.fromDate(loggedAt as Date));
    }
    const mealLogWithStreak = {
      ...mealLog,
      streak
    };

    if (existingMeal) {
      await mealLogRef.set(mealLogWithStreak, { merge: true });
    } else {
      await mealLogRef.set(mealLogWithStreak);
    }
    await aiRunRef.set(
      {
        status: "completed",
        mealLogId: mealLogRef.id,
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        fallbackUsed,
        completedAt: savedAt,
        output: analysis,
        ...(isBackdated ? { backdated: true, intendedDayKey } : {})
      },
      { merge: true }
    );

    return { runId: aiRunRef.id, mealLogId: mealLogRef.id, mealLog: mealLogWithStreak };
  } catch (error) {
    await aiRunRef.set(
      error instanceof MealImageUnclearError
        ? {
            status: "not-analyzable",
            rejectedAt: Timestamp.now(),
            reason: "unclear-image"
          }
        : {
            status: "failed",
            failedAt: Timestamp.now(),
            error: error instanceof Error ? error.message : String(error)
          },
      { merge: true }
    );
    throw error;
  }
}

function resolveMealLoggedAt(
  dayKey: string | undefined,
  now: Date
): { loggedAt: Timestamp; dayKey: string; isBackdated: boolean } {
  const todayKey = formatBangkokIsoDayKey(now);
  if (!dayKey) {
    return { loggedAt: Timestamp.fromDate(now), dayKey: todayKey, isBackdated: false };
  }
  const validation = validateLoggedAtDayKey(dayKey, now);
  if (!validation.ok) {
    throw new Error(validation.error);
  }
  if (!validation.isBackdated) {
    return { loggedAt: Timestamp.fromDate(now), dayKey: validation.dayKey, isBackdated: false };
  }
  return {
    loggedAt: Timestamp.fromDate(bangkokLoggedAtForDayKey(validation.dayKey, now)),
    dayKey: validation.dayKey,
    isBackdated: true
  };
}

async function readProfileStreak(canonicalUserId: string) {
  const profileSnap = await db.collection("profiles").doc(canonicalUserId).get();
  return normalizeStreak(profileSnap.exists ? profileSnap.data() ?? {} : {});
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
  const primaryProvider = agent.provider;
  const primaryModel = agent.model;

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
    const analysis = await callGeminiExerciseAnalysis(request, getAiProviderApiKeys(), agent);
    const fallbackUsed = didUseAiFallback(agent, primaryProvider, primaryModel);
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
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        promptVersion: agent.promptVersion,
        fallbackUsed
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
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        fallbackUsed,
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
  const primaryProvider = agent.provider;
  const primaryModel = agent.model;

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
    const answer = await callGeminiCoachConsultation(request, getAiProviderApiKeys(), agent);
    const fallbackUsed = didUseAiFallback(agent, primaryProvider, primaryModel);
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
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        promptVersion: agent.promptVersion,
        fallbackUsed
      },
      createdAt: savedAt,
      updatedAt: savedAt
    });
    await aiRunRef.set(
      {
        status: "completed",
        consultationId: consultationRef.id,
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        fallbackUsed,
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
    await replyToLine(replyToken, "ข้อความชนิดนี้ยังไม่รองรับครับ กรุณาส่งข้อความ รูปภาพ หรือไฟล์ PDF/รูปภาพ BIA");
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
  const supportControl = await handleSupportReplyControlCommand(text, replyToken, canonicalUserId, lineUserId);
  if (supportControl) {
    return { ok: true, type: event.type, canonicalUserId, ...supportControl };
  }

  const forwardedToAdmin = await forwardCustomerReplyIfSupportIntent(
    text,
    replyToken,
    lineUserId,
    canonicalUserId
  );
  if (forwardedToAdmin) {
    return { ok: true, type: event.type, canonicalUserId, status: "support-reply-forwarded-to-admin" };
  }

  const commandResult = await handleLineTextCommand(text, replyToken, canonicalUserId, lineUserId);
  if (commandResult) {
    return { ok: true, type: event.type, canonicalUserId, ...commandResult };
  }

  if (isKnownLegacyCommand(text)) {
    await replyToLine(replyToken, "ยังไม่รองรับคำสั่งนี้ครับ พิมพ์ \"คู่มือ\" เพื่อดูคำสั่งที่ใช้งานได้");
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

  const backdateFromText = parseMealBackdateCommand(text);
  if (backdateFromText && !backdateFromText.mealText) {
    // Absolute date alone (e.g. "19 ก.ย.") acts like a bare backdate command.
    await db.collection("backdateIntents").doc(canonicalUserId).set({
      dayKey: backdateFromText.dayKey,
      label: backdateFromText.label,
      createdAt: Timestamp.now()
    });
    const cfg = await getAppRuntimeConfig();
    const mealLogUrl = buildLiffMealLogUrl(cfg.liffSettingsUrl, backdateFromText.dayKey);
    await replyToLineMessages(replyToken, [buildBackdatePromptMessage(mealLogUrl, backdateFromText.label)]);
    return {
      ok: true,
      type: event.type,
      canonicalUserId,
      status: "backdate-intent-set",
      dayKey: backdateFromText.dayKey
    };
  }

  const rejectedBackdate = backdateFromText ? null : findRejectedBackdate(text);
  if (rejectedBackdate) {
    await replyToLine(replyToken, formatRejectedBackdateReply(rejectedBackdate));
    return {
      ok: true,
      type: event.type,
      canonicalUserId,
      status: "backdate-day-rejected",
      error: rejectedBackdate.error,
      dayKey: rejectedBackdate.dayKey
    };
  }

  const intentDayKey = backdateFromText ? null : await readBackdateIntent(canonicalUserId);
  const loggedAtDayKey = backdateFromText?.dayKey ?? intentDayKey ?? undefined;
  const mealText = backdateFromText?.mealText || text;

  try {
    await showLoadingAnimation(lineUserId, 15);
    const saved = await analyzeAndSaveMeal({
      userId: canonicalUserId,
      canonicalUserId,
      source: "line",
      inputType: "text",
      text: mealText,
      loggedAtDayKey
    });
    if (intentDayKey) await markBackdateIntentUsed(canonicalUserId);

    await replyWithMealCard(replyToken, canonicalUserId, lineUserId, { ...saved.mealLog, id: saved.mealLogId });
    return {
      ok: true,
      type: event.type,
      status: loggedAtDayKey && saved.mealLog.backdated
        ? "backdated-meal-analyzed-and-replied"
        : "meal-analyzed-and-replied",
      canonicalUserId,
      runId: saved.runId,
      mealLogId: saved.mealLogId,
      loggedAtDayKey: loggedAtDayKey ?? null
    };
  } catch (error) {
    await replyToLine(replyToken, "ขออภัยครับ ระบบวิเคราะห์อาหารขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง");
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

// A backdate intent ("บันทึกเมื่อวาน") waits up to 10 minutes for the first
// meal. Once used it stays open only briefly so a burst of photos from the same
// day all land there, without capturing a real-time meal sent minutes later.
const BACKDATE_INTENT_TTL_MS = 10 * 60 * 1000;
const BACKDATE_INTENT_FOLLOW_UP_MS = 2 * 60 * 1000;

// Read without consuming: the intent is only marked used after the meal saves,
// so a failed analysis (e.g. Gemini 503) keeps it for the retry.
async function readBackdateIntent(canonicalUserId: string): Promise<string | null> {
  return (await readBackdateIntentState(canonicalUserId))?.dayKey ?? null;
}

async function readBackdateIntentState(
  canonicalUserId: string
): Promise<{ dayKey: string; label: string; used: boolean } | null> {
  const ref = db.collection("backdateIntents").doc(canonicalUserId);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};
  const nowMs = Timestamp.now().toMillis();
  const createdAtMs = normalizeTimestamp(data.createdAt)?.toMillis() ?? 0;
  const lastUsedAtMs = normalizeTimestamp(data.lastUsedAt)?.toMillis();
  const active = lastUsedAtMs === undefined
    ? nowMs - createdAtMs < BACKDATE_INTENT_TTL_MS
    : nowMs - lastUsedAtMs < BACKDATE_INTENT_FOLLOW_UP_MS;
  const validation = validateLoggedAtDayKey(String(data.dayKey ?? ""));
  if (!active || !validation.ok) {
    await ref.delete();
    return null;
  }
  return {
    dayKey: validation.dayKey,
    label: String(data.label ?? formatThaiShortDayLabel(validation.dayKey)),
    used: lastUsedAtMs !== undefined
  };
}

function formatRejectedBackdateReply(rejected: RejectedBackdate): string {
  const label = formatThaiShortDayLabel(rejected.dayKey);
  return rejected.error === "future-day-not-allowed"
    ? `วันที่ ${label} ยังมาไม่ถึงครับ บันทึกมื้อล่วงหน้าไม่ได้ ยังไม่ได้บันทึกมื้อนี้`
    : `บันทึกย้อนหลังได้ไม่เกิน ${MAX_BACKDATE_DAYS} วันครับ (วันที่ ${label} เกินกำหนด) ยังไม่ได้บันทึกมื้อนี้`;
}

async function markBackdateIntentUsed(canonicalUserId: string): Promise<void> {
  await db.collection("backdateIntents").doc(canonicalUserId)
    .set({ lastUsedAt: Timestamp.now() }, { merge: true })
    .catch((error) => console.warn("backdate intent touch failed", canonicalUserId, error));
}

async function clearBackdateIntent(canonicalUserId: string): Promise<void> {
  await db.collection("backdateIntents").doc(canonicalUserId).delete()
    .catch((error) => console.warn("backdate intent clear failed", canonicalUserId, error));
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

    // The "หักของเหลือ" button sets a short-lived intent so the next image is
    // forced down the leftover path regardless of what it looks like.
    const leftoverIntentRef = db.collection("leftoverIntents").doc(canonicalUserId);
    const leftoverIntentSnap = await leftoverIntentRef.get();
    const leftoverIntentActive = leftoverIntentSnap.exists &&
      Timestamp.now().toMillis() - (normalizeTimestamp(leftoverIntentSnap.data()?.createdAt)?.toMillis() ?? 0) < 10 * 60 * 1000;
    if (leftoverIntentSnap.exists) await leftoverIntentRef.delete();

    // Backdate intent (from "บันทึกเมื่อวาน" etc.) applies only to a new food
    // image — leftover intent takes priority when both are somehow present.
    const backdateDayKey = leftoverIntentActive ? null : await readBackdateIntent(canonicalUserId);

    // Give the classifier the latest meal name so it can tell a leftover of that
    // meal apart from a new dish (GAS parity).
    const latestMealForClassify = await getLatestMealLog(canonicalUserId);
    const latestMealNameForClassify = latestMealForClassify
      ? String(latestMealForClassify.data().mealNameTh ?? latestMealForClassify.data().mealNameEn ?? "")
      : "";

    const classification = await classifyLineImage(content.base64, content.mimeType, latestMealNameForClassify);
    const classifiedType = leftoverIntentActive ? "leftover" : classification.type;

    if (classifiedType === "slip") {
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

    if (classifiedType === "bia") {
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

    if (classifiedType === "leftover") {
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

    if (classifiedType === "unclear_food") {
      await replyToLine(replyToken, UNREADABLE_FOOD_IMAGE_REPLY);
      return { ok: true, type: event.type, status: "unclear-food-image-replied", canonicalUserId };
    }

    if (classifiedType === "other") {
      await replyToLine(replyToken, UNREADABLE_FOOD_IMAGE_REPLY);
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
      mimeType: content.mimeType,
      loggedAtDayKey: backdateDayKey ?? undefined
    });
    if (backdateDayKey) await markBackdateIntentUsed(canonicalUserId);

    await replyWithMealCard(replyToken, canonicalUserId, lineUserId, { ...saved.mealLog, id: saved.mealLogId });
    return {
      ok: true,
      type: event.type,
      status: saved.mealLog.backdated
        ? "backdated-image-meal-analyzed-and-replied"
        : "image-meal-analyzed-and-replied",
      canonicalUserId,
      runId: saved.runId,
      mealLogId: saved.mealLogId,
      mimeType: content.mimeType,
      imageType: classification.type,
      loggedAtDayKey: backdateDayKey
    };
  } catch (error) {
    if (error instanceof MealImageUnclearError) {
      await replyToLine(replyToken, UNREADABLE_FOOD_IMAGE_REPLY);
      return {
        ok: true,
        type: event.type,
        status: "unclear-food-image-replied",
        canonicalUserId
      };
    }
    await replyToLine(replyToken, "ขออภัยครับ ระบบวิเคราะห์รูปอาหารขัดข้องชั่วคราว กรุณาลองส่งรูปอีกครั้ง");
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
      await replyToLine(replyToken, "รองรับรายงาน BIA เป็นไฟล์ PDF หรือรูปภาพเท่านั้นครับ");
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
    await replyToLine(replyToken, "ขออภัยครับ ระบบรับไฟล์ BIA/PDF ขัดข้องชั่วคราว กรุณาลองส่งอีกครั้ง");
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
    // Use the date printed on the BIA report, not the day it was forwarded.
    const reportDate = parseBiaReportDate(analysis.meta?.date_str, savedAt);
    await reportRef.set({
      status: "analysis-completed",
      analysis,
      reportDate,
      analyzedAt: savedAt,
      updatedAt: savedAt
    }, { merge: true });

    await saveWeightLogFromBia(input.canonicalUserId, analysis, reportDate);
    await db.collection("profileEvents").add({
      type: "bia-analysis",
      biaReportId: reportRef.id,
      canonicalUserId: input.canonicalUserId,
      lineUserId: input.lineUserId,
      analysis,
      createdAt: savedAt
    });

    // Only the Flex card goes to the user; no extra admin text on success.
    await replyToLineMessages(input.replyToken, [buildBiaReplyMessage(reportRef.id, profile, analysis)]);
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
      "ระบบยังวิเคราะห์ไฟล์นี้ไม่สำเร็จ จึงบันทึกไว้ให้แอดมินตรวจต่อ",
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

  return callGeminiBiaAnalysis({
    base64,
    mimeType,
    displayName: profile.name,
    currentTargetCal: profile.target.cal
  }, getAiProviderApiKeys(), agent);
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

// Parse "DD/MM/YYYY" (Gregorian or Buddhist year) from a BIA report. Falls back
// to the submission time for "TODAY", blanks, or anything unparseable/future.
function parseBiaReportDate(dateStr: unknown, fallback: Timestamp): Timestamp {
  const text = String(dateStr ?? "").trim();
  if (!text || /today|วันนี้/i.test(text)) return fallback;
  const match = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(text);
  if (!match) return fallback;
  let day = Number(match[1]);
  let month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543;
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return fallback;
  const ms = Date.UTC(year, month - 1, day, 5, 0, 0); // ~noon Bangkok
  return Number.isNaN(ms) || ms > fallback.toMillis() ? fallback : Timestamp.fromMillis(ms);
}

async function classifyLineImage(base64: string, mimeType: string, latestMealName = "") {
  const agent = await getAiAgentConfig("mealAnalysis");
  if (!agent.enabled) {
    return { type: "food" as const, confidence: 0 };
  }

  try {
    return await callGeminiImageClassification(base64, mimeType, getAiProviderApiKeys(), agent, latestMealName);
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
    amount,
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

  const receiverName = String(input.slipData.receiver_name ?? "").trim();
  const bankTo = String(input.slipData.bank_to ?? "").trim();
  const bankFrom = String(input.slipData.bank_from ?? "").trim();
  const slipWhen = `${String(input.slipData.date ?? "")} ${String(input.slipData.time ?? "")}`.trim();
  const adminRow = (label: string, value: string): Record<string, unknown> => ({
    type: "box", layout: "horizontal", margin: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#6B7280", flex: 2 },
      { type: "text", text: value, size: "sm", color: "#374151", weight: "bold", flex: 5, wrap: true, align: "end" }
    ]
  });
  await pushMessages(ADMIN_LINE_USER_ID.value(), [{
    type: "flex",
    altText: `สลิปใหม่รอตรวจ • ${profile.name} • ${amount ? `${amount} บาท` : "-"} • อนุมัติ ${input.lineUserId} 30`.slice(0, 400),
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", backgroundColor: "#FFFFFF", paddingAll: "16px",
        contents: [
          { type: "text", text: "สลิปโอนเงินใหม่รอตรวจ", weight: "bold", size: "md", color: "#111827" },
          adminRow("ลูกค้า", String(profile.name ?? "-")),
          adminRow("ยอด", amount ? `${amount} บาท` : "-"),
          adminRow("โอนเข้า", receiverName ? `${receiverName}${bankTo ? ` · ${bankTo}` : ""}` : "อ่านไม่ได้"),
          adminRow("จากบัญชี", bankFrom || "-"),
          adminRow("วัน-เวลาในสลิป", slipWhen || "-"),
          ...(receiverName ? [] : [{ type: "text", text: "⚠️ อ่านชื่อบัญชีผู้รับไม่ได้ — ตรวจรูปสลิปก่อนอนุมัติ", size: "sm", color: "#C0392B", weight: "bold", margin: "md", wrap: true }]),
          { type: "text", text: `LINE: ${input.lineUserId}`, size: "xxs", color: "#9CA3AF", margin: "md", wrap: true },
          { type: "text", text: `Review: ${reviewRef.id}`, size: "xxs", color: "#9CA3AF" }
        ]
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px",
        contents: [
          { type: "button", style: "primary", color: "#1D9E75", height: "sm",
            action: { type: "message", label: "✅ อนุมัติ 30 วัน", text: `อนุมัติ ${input.lineUserId} 30` } },
          { type: "button", style: "primary", color: "#0F6E56", height: "sm",
            action: { type: "message", label: "✅ อนุมัติ 90 วัน", text: `อนุมัติ ${input.lineUserId} 90` } },
          { type: "button", style: "secondary", height: "sm",
            action: { type: "message", label: "👑 Lifetime / VIP", text: `อนุมัติ ${input.lineUserId} lifetime` } },
          { type: "button", style: "secondary", height: "sm",
            action: { type: "message", label: "❌ ปฏิเสธ", text: `ปฏิเสธ ${input.lineUserId}` } }
        ]
      }
    }
  }]);

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
  const subscriptionCommand = parseAdminSubscriptionCommand(text);
  if (subscriptionCommand) {
    const result = await handleAdminSubscriptionCommand(subscriptionCommand, replyToken, adminLineUserId);
    return { status: `admin-subscription-${subscriptionCommand.action}`, ...result };
  }

  const legacyChatCommand = text.startsWith("คุย") ||
    text === "จบ" ||
    text === "ออก" ||
    text.toLowerCase() === "exit";
  if (legacyChatCommand) {
    await replyToLine(
      replyToken,
      "ระบบคุยแบบเดิมย้ายไปที่ Admin Dashboard แล้วครับ\nเปิดเมนู “ข้อความลูกค้า” เพื่ออ่าน ตอบ และปิดเคสได้โดยไม่ต้องจำคำสั่ง"
    );
    return { status: "admin-support-dashboard-replied" };
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

  if (text === "หักของเหลือ") {
    await db.collection("leftoverIntents").doc(canonicalUserId).set({ createdAt: Timestamp.now() });
    await replyToLine(replyToken, "ส่งรูปของเหลือของมื้อล่าสุดมาได้เลยครับ ระบบจะหักออกจากที่บันทึกไว้ให้");
    return { status: "leftover-intent-set" };
  }

  // Leave backdate mode. Plain "ยกเลิก" normally undoes the last meal, but while
  // a backdate intent is still waiting for its first meal, cancelling the mode
  // is what the user means — deleting an unrelated meal would be destructive.
  if (/^ยกเลิก\s*(?:บันทึก)?\s*(?:ย้อนหลัง|เมื่อวาน|มื้อเก่า)$/.test(text) || text === "ยกเลิก") {
    const pending = await readBackdateIntentState(canonicalUserId);
    if (pending && (text !== "ยกเลิก" || !pending.used)) {
      await clearBackdateIntent(canonicalUserId);
      await replyToLine(replyToken, `ยกเลิกบันทึกย้อนหลัง (${pending.label}) แล้วครับ มื้อต่อไปจะบันทึกเป็นวันนี้`);
      return { status: "backdate-intent-cancelled", dayKey: pending.dayKey };
    }
    if (text !== "ยกเลิก") {
      await replyToLine(replyToken, "ตอนนี้ไม่ได้อยู่ในโหมดบันทึกย้อนหลังครับ มื้อต่อไปจะบันทึกเป็นวันนี้");
      return { status: "backdate-intent-none" };
    }
  }

  const bareBackdate = isBareBackdateCommand(text);
  if (bareBackdate) {
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-backdate" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-backdate" };
    }
    await db.collection("backdateIntents").doc(canonicalUserId).set({
      dayKey: bareBackdate.dayKey,
      label: bareBackdate.label,
      createdAt: Timestamp.now()
    });
    const cfg = await getAppRuntimeConfig();
    const mealLogUrl = buildLiffMealLogUrl(cfg.liffSettingsUrl, bareBackdate.dayKey);
    await replyToLineMessages(replyToken, [buildBackdatePromptMessage(mealLogUrl, bareBackdate.label)]);
    return { status: "backdate-intent-set", dayKey: bareBackdate.dayKey };
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

  // A bare "ตั้งค่า" (e.g. from the rich menu) opens the web settings form.
  // Only "ตั้งค่า <numbers>" goes to the manual text-command parser below.
  if (text.trim() === "ตั้งค่า") {
    const cfg = await getAppRuntimeConfig();
    const settingsUrl = `${cfg.liffSettingsUrl}&uid=${encodeURIComponent(lineUserId)}`;
    await replyToLineMessages(replyToken, [buildSettingsLinkMessage(settingsUrl)]);
    return { status: "settings-link-replied" };
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
    const helpConfig = await getAppRuntimeConfig();
    await replyToLineMessages(replyToken, [buildHelpFlexMessage(
      `${helpConfig.liffSettingsUrl}&uid=${encodeURIComponent(lineUserId)}`,
      await createDashboardAccessUrl(canonicalUserId)
    )]);
    return { status: "help-replied" };
  }

  if (text === "ออกกำลังกาย") {
    await replyToLine(replyToken, formatExerciseGuideReply());
    return { status: "exercise-guide-replied" };
  }

  const portionAdjustment = parsePortionAdjustmentCommand(text);
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

  if (isExerciseRecommendationRequest(text) || looksLikeMenuRecommendationRequest(text) || looksLikeCoachConsultationRequest(text)) {
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-coach-consultation" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-coach-consultation" };
    }

    const coachText = isExerciseRecommendationRequest(text)
      ? "วันนี้ควรออกกำลังกายแบบไหนดี จากยอดอาหารที่กินไปแล้ว"
      : text;
    const mode = looksLikeMenuRecommendationRequest(coachText) ? "menu_recommendation" : "consultation";
    await showLoadingAnimation(lineUserId, 15);
    const saved = await analyzeAndSaveCoachConsultation({
      userId: canonicalUserId,
      lineUserId,
      source: "line",
      text: coachText,
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
    // Exercise logs always count toward today's burn, so a past-day workout
    // must not be silently added to today's quota.
    if (parseMealBackdateCommand(text) || findRejectedBackdate(text)) {
      await replyToLine(
        replyToken,
        "ตอนนี้บันทึกกิจกรรมย้อนหลังยังไม่ได้ครับ บันทึกได้เฉพาะกิจกรรมของวันนี้ (บันทึกย้อนหลังได้เฉพาะมื้ออาหาร)"
      );
      return { status: "backdated-exercise-not-supported" };
    }
    const readiness = await getUserReadiness(canonicalUserId);
    if (!readiness.profileComplete) {
      await replyWithOnboarding(replyToken, lineUserId);
      return { status: "profile-required-before-exercise" };
    }
    if (!readiness.subscriptionActive) {
      await handleSubscriptionRequest(replyToken, canonicalUserId, lineUserId, "วันใช้งานหมดแล้วครับ");
      return { status: "subscription-required-before-exercise" };
    }

    await showLoadingAnimation(lineUserId, 15);
    const saved = await analyzeAndSaveExercise({
      userId: canonicalUserId,
      canonicalUserId,
      source: "line",
      text
    });
    const profile = await getUserProfile(canonicalUserId);
    const summary = await getTodaySummary(canonicalUserId, profile);
    await replyToLineMessages(replyToken, [await buildExerciseCardMessage(
      canonicalUserId,
      { ...saved.exerciseLog, id: saved.exerciseLogId },
      summary
    )]);
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
    await replyToLineMessages(replyToken, [buildDashboardLinkMessage(await createDashboardAccessUrl(canonicalUserId))]);
    return { status: "dashboard-link-replied" };
  }

  if (text.includes("สรุป") || text.includes("ยอด")) {
    const profile = await getUserProfile(canonicalUserId);
    const summary = await getTodaySummary(canonicalUserId, profile);
    await replyToLineMessages(replyToken, [buildDailySummaryFlexMessage(
      profile,
      summary,
      await createDashboardAccessUrl(canonicalUserId)
    )]);
    return { status: "daily-summary-replied" };
  }

  if (isDeleteExerciseCommand(text)) {
    const result = await deleteLastExerciseLog(canonicalUserId);
    if (!result.deleted) {
      await replyToLine(replyToken, result.message);
      return { status: "last-exercise-not-found" };
    }
    const profile = await getUserProfile(canonicalUserId);
    const summary = await getTodaySummary(canonicalUserId, profile);
    await replyToLine(replyToken, [
      result.message,
      `เป้าหมายวันนี้กลับเป็น ${Math.round(summary.dynamicTarget)} kcal`,
      `ยังกินได้อีก ${Math.round(summary.remaining.cal)} kcal`
    ].join("\n"));
    return { status: "last-exercise-deleted", exerciseLogId: result.exerciseLogId };
  }

  if (text === "ลบ" || text === "ยกเลิก" || lower === "undo") {
    const result = await deleteLastMealLog(canonicalUserId);
    // Undoing a mis-dated meal should not let the next photo land there too.
    await clearBackdateIntent(canonicalUserId);
    await replyToLine(replyToken, result.message);
    return { status: result.deleted ? "last-meal-deleted" : "last-meal-not-found" };
  }

  if (text.includes("น้ำหนัก") || text.startsWith("หนัก") || lower.startsWith("weight")) {
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
  const target = parseConfirmUpdateTargetCommand(text);
  if (!target) {
    await replyToLine(replyToken, "รูปแบบยืนยันเป้าหมายไม่ถูกต้องครับ เช่น `CONFIRM_UPDATE_TARGET 2200 150-200-60`");
    return { updated: false, reason: "invalid-target-confirmation" };
  }

  const now = Timestamp.now();
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
  const subscriptionState = await getSubscriptionState(canonicalUserId);
  const expiresAt = subscriptionState.expiresAt ?? (subscriptionState.lifetime ? null : subscriptionExpiryAfterDays(3, null));
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
      status: subscriptionState.lifetime || (expiresAt && expiresAt.toMillis() >= Date.now()) ? "active" : "expired",
      entitlementType: subscriptionState.lifetime ? "lifetime" : "trial",
      lifetime: subscriptionState.lifetime,
      expiresAt,
      trialGranted: subscriptionState.expiresAt || subscriptionState.lifetime ? false : true,
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
    subscriptionState.expiresAt || subscriptionState.lifetime
      ? `หมดอายุ: ${formatSubscriptionStatus(expiresAt, subscriptionState.lifetime)}`
      : `เริ่มทดลองใช้ฟรีถึง: ${formatSubscriptionStatus(expiresAt)}`
  ].join("\n"));

  return {
    updated: true,
    trialGranted: !subscriptionState.expiresAt && !subscriptionState.lifetime,
    lifetime: subscriptionState.lifetime,
    expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null
  };
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
  const appConfig = await getAppRuntimeConfig();
  const plans = await getVisibleSubscriptionPlans();
  const packageLines = plans.map(formatSubscriptionPlanLine);
  const expireText = formatSubscriptionStatus(profile.expiresAt ?? null, Boolean(profile.lifetime));
  const message = [
    warningText,
    `สมาชิก: ${profile.name}`,
    `หมดอายุ: ${expireText}`,
    "",
    "แพ็กเกจเติมวัน",
    ...packageLines,
    "",
    "โอนเงินแล้วส่งรูปสลิปกลับมาในแชทนี้ได้เลยครับ แอดมินจะตรวจสอบและเปิดสิทธิ์ให้",
    `QR: ${appConfig.paymentQrImage}`
  ].filter((line) => line !== "").join("\n");

  await db.collection("subscriptionRequests").add({
    canonicalUserId,
    lineUserId,
    displayName: profile.name,
    status: "payment-instructions-sent",
    packages: plans,
    paymentQrImage: appConfig.paymentQrImage,
    createdAt: Timestamp.now()
  });
  await replyToLine(replyToken, message);
  return { requested: true, packages: plans.length };
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
  let result: { ok: boolean; days: number | null; lifetime: boolean; expiresAt: Timestamp | null; reason?: string } = {
    ok: false,
    days: 0,
    lifetime: false,
    expiresAt: null
  };

  await db.runTransaction(async (transaction) => {
    const codeSnap = await transaction.get(codeRef);
    if (!codeSnap.exists) {
      result = { ok: false, days: 0, lifetime: false, expiresAt: null, reason: "not-found" };
      return;
    }

    const codeData = codeSnap.data() ?? {};
    const status = String(codeData.status ?? "").toLowerCase();
    const lifetime = Boolean(codeData.lifetime || codeData.entitlementType === "lifetime");
    const days = lifetime ? null : Number(codeData.days ?? codeData.Days ?? 0);
    if (!lifetime && (!days || days <= 0)) {
      result = { ok: false, days: 0, lifetime: false, expiresAt: null, reason: "invalid-days" };
      return;
    }
    if (status && status !== "available") {
      result = { ok: false, days, lifetime, expiresAt: null, reason: "already-used" };
      return;
    }

    const existingSubscription = await getSubscriptionStateInTransaction(transaction, canonicalUserId);
    const effectiveLifetime = lifetime || existingSubscription.lifetime;
    const newExpiry = effectiveLifetime ? null : subscriptionExpiryAfterDays(days ?? 0, existingSubscription.expiresAt);
    const now = Timestamp.now();
    transaction.set(db.collection("subscriptions").doc(canonicalUserId), {
      userId: canonicalUserId,
      canonicalUserId,
      status: "active",
      entitlementType: effectiveLifetime ? "lifetime" : "duration",
      lifetime: effectiveLifetime,
      expiresAt: newExpiry,
      lastRedeemedCode: code,
      updatedAt: now
    }, { merge: true });
    transaction.set(db.collection("users").doc(canonicalUserId), {
      subscriptionStatus: "active",
      subscriptionExpiresAt: newExpiry,
      subscriptionLifetime: effectiveLifetime,
      updatedAt: now
    }, { merge: true });
    transaction.set(db.collection("profiles").doc(canonicalUserId), {
      expiresAt: newExpiry,
      lifetime: effectiveLifetime,
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
      lifetime: effectiveLifetime,
      expiresAt: newExpiry,
      createdAt: now
    });
    result = { ok: true, days, lifetime: effectiveLifetime, expiresAt: newExpiry };
  });

  if (!result.ok) {
    await replyToLine(replyToken, `โค้ดนี้ใช้ไม่ได้ครับ (${result.reason ?? "unknown"})`);
    return { redeemed: false, reason: result.reason ?? "unknown" };
  }

  const redeemedLabel = result.lifetime ? "lifetime" : `+${result.days} วัน`;
  await replyToLine(replyToken, `เติมวันสำเร็จ (${redeemedLabel})\nหมดอายุ: ${formatSubscriptionStatus(result.expiresAt, result.lifetime)}`);
  return {
    redeemed: true,
    days: result.days,
    lifetime: result.lifetime,
    expiresAt: result.expiresAt ? result.expiresAt.toDate().toISOString() : null
  };
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
    const pendingReviews = await getPendingPaymentReviews(target.canonicalUserId);
    const reviewPayload = {
      status: "rejected",
      adminDecision: "rejected",
      reason: command.reason,
      reviewedBy: adminLineUserId,
      reviewedAt: now,
      updatedAt: now
    };
    const batch = db.batch();
    if (pendingReviews.length) {
      pendingReviews.forEach((review) => batch.set(review.ref, reviewPayload, { merge: true }));
    } else {
      batch.set(db.collection("paymentReviews").doc(), {
        canonicalUserId: target.canonicalUserId,
        lineUserId: target.lineUserId,
        ...reviewPayload,
        createdAt: now
      });
    }
    batch.set(db.collection("subscriptionEvents").doc(), {
      type: "admin-reject",
      canonicalUserId: target.canonicalUserId,
      lineUserId: target.lineUserId,
      reason: command.reason,
      adminLineUserId,
      createdAt: now
    });
    await batch.commit();
    if (target.lineUserId) {
      await pushMessage(target.lineUserId, "สลิปของคุณยังไม่ผ่านการตรวจสอบครับ กรุณาติดต่อแอดมินหรือลองส่งใหม่อีกครั้ง");
    }
    await replyToLine(replyToken, `ปฏิเสธรายการของ ${target.canonicalUserId} แล้ว`);
    return { ok: true, canonicalUserId: target.canonicalUserId, action: "reject" };
  }

  const grant = await resolveSubscriptionGrant(command.grantInput);
  if (!grant) {
    await replyToLine(replyToken, "แพ็กเกจ/จำนวนวันไม่ถูกต้องครับ เช่น `อนุมัติ Uxxxxxxxx 30`, `approve Uxxxxxxxx 90d`, หรือ `approve Uxxxxxxxx lifetime`");
    return { ok: false, reason: "invalid-subscription-grant", grantInput: command.grantInput };
  }
  const [currentExpiry, pendingReviews] = await Promise.all([
    getSubscriptionExpiry(target.canonicalUserId),
    getPendingPaymentReviews(target.canonicalUserId)
  ]);
  const expiresAt = grant.lifetime ? null : subscriptionExpiryAfterDays(grant.days ?? 0, currentExpiry);
  const now = Timestamp.now();
  const batch = db.batch();
  batch.set(db.collection("subscriptions").doc(target.canonicalUserId), {
      userId: target.canonicalUserId,
      canonicalUserId: target.canonicalUserId,
      status: "active",
      entitlementType: grant.lifetime ? "lifetime" : "duration",
      lifetime: grant.lifetime,
      expiresAt,
      lastApprovedDays: grant.days,
      lastApprovedPlanId: grant.planId,
      lastApprovedPlanLabel: grant.labelTh,
      lastApprovedPriceThb: grant.priceThb,
      lastApprovedBy: adminLineUserId,
      lastApprovedAt: now,
      updatedAt: now
    }, { merge: true });
  batch.set(db.collection("users").doc(target.canonicalUserId), {
      subscriptionStatus: "active",
      subscriptionExpiresAt: expiresAt,
      subscriptionLifetime: grant.lifetime,
      updatedAt: now
    }, { merge: true });
  batch.set(db.collection("profiles").doc(target.canonicalUserId), {
      expiresAt,
      lifetime: grant.lifetime,
      updatedAt: now
    }, { merge: true });

  let approvedReviewId: string | null = null;
  if (pendingReviews.length) {
    const [approvedReview, ...duplicateReviews] = pendingReviews;
    approvedReviewId = approvedReview.id;
    batch.set(approvedReview.ref, {
        status: "approved",
        adminDecision: "approved",
        days: grant.days,
        planId: grant.planId,
        planLabel: grant.labelTh,
        lifetime: grant.lifetime,
        expiresAt,
        reviewedBy: adminLineUserId,
        reviewedAt: now,
        updatedAt: now
      }, { merge: true });
    duplicateReviews.forEach((review) => batch.set(review.ref, {
      status: "superseded",
      adminDecision: "superseded-by-approval",
      supersededByPaymentReviewId: approvedReview.id,
      reviewedBy: adminLineUserId,
      reviewedAt: now,
      updatedAt: now
    }, { merge: true }));
  } else {
    const approvedReview = db.collection("paymentReviews").doc();
    approvedReviewId = approvedReview.id;
    batch.set(approvedReview, {
        canonicalUserId: target.canonicalUserId,
        lineUserId: target.lineUserId,
        status: "approved",
        adminDecision: "approved",
        days: grant.days,
        planId: grant.planId,
        planLabel: grant.labelTh,
        lifetime: grant.lifetime,
        expiresAt,
        reviewedBy: adminLineUserId,
        reviewedAt: now,
        createdAt: now
      });
  }
  batch.set(db.collection("subscriptionEvents").doc(), {
      type: "admin-approve",
      paymentReviewId: approvedReviewId,
      canonicalUserId: target.canonicalUserId,
      lineUserId: target.lineUserId,
      days: grant.days,
      planId: grant.planId,
      planLabel: grant.labelTh,
      priceThb: grant.priceThb,
      lifetime: grant.lifetime,
      expiresAt,
      adminLineUserId,
      createdAt: now
    });
  await batch.commit();

  if (target.lineUserId) {
    await pushMessage(target.lineUserId, `ชำระเงินสำเร็จ ระบบเปิดสิทธิ์ ${grant.labelTh}\nหมดอายุ: ${formatSubscriptionStatus(expiresAt, grant.lifetime)}`);
  }
  await replyToLine(replyToken, `อนุมัติ ${target.canonicalUserId} ${grant.labelTh}\nหมดอายุ: ${formatSubscriptionStatus(expiresAt, grant.lifetime)}`);
  return {
    ok: true,
    canonicalUserId: target.canonicalUserId,
    lineUserId: target.lineUserId,
    action: "approve",
    days: grant.days,
    planId: grant.planId,
    lifetime: grant.lifetime,
    expiresAt: expiresAt ? expiresAt.toDate().toISOString() : null
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

async function getPendingPaymentReviews(canonicalUserId: string) {
  const snap = await db.collection("paymentReviews")
    .where("canonicalUserId", "==", canonicalUserId)
    .where("status", "==", "pending-admin-review")
    .orderBy("createdAt", "desc")
    .limit(450)
    .get();
  return snap.docs;
}

async function getSubscriptionExpiry(canonicalUserId: string): Promise<Timestamp | null> {
  const snap = await db.collection("subscriptions").doc(canonicalUserId).get();
  return snap.exists ? normalizeTimestamp(snap.data()?.expiresAt) : null;
}

async function getSubscriptionState(canonicalUserId: string): Promise<SubscriptionState> {
  const snap = await db.collection("subscriptions").doc(canonicalUserId).get();
  const data = snap.exists ? snap.data() ?? {} : {};
  const status = String(data.status ?? "").toLowerCase();
  const lifetime = Boolean(data.lifetime || data.entitlementType === "lifetime");
  const expiresAt = normalizeTimestamp(data.expiresAt);
  const active = status === "active" && (lifetime || Boolean(expiresAt && expiresAt.toMillis() >= Date.now()));
  return { active, lifetime, expiresAt, status };
}

async function getSubscriptionStateInTransaction(
  transaction: Transaction,
  canonicalUserId: string
): Promise<SubscriptionState> {
  const snap = await transaction.get(db.collection("subscriptions").doc(canonicalUserId));
  const data = snap.exists ? snap.data() ?? {} : {};
  const status = String(data.status ?? "").toLowerCase();
  const lifetime = Boolean(data.lifetime || data.entitlementType === "lifetime");
  const expiresAt = normalizeTimestamp(data.expiresAt);
  const active = status === "active" && (lifetime || Boolean(expiresAt && expiresAt.toMillis() >= Date.now()));
  return { active, lifetime, expiresAt, status };
}

function subscriptionExpiryAfterDays(days: number, currentExpiry: Timestamp | null): Timestamp {
  const nowMs = Date.now();
  const baseMs = currentExpiry && currentExpiry.toMillis() > nowMs ? currentExpiry.toMillis() : nowMs;
  return Timestamp.fromMillis(baseMs + days * 24 * 60 * 60 * 1000);
}

async function getAppRuntimeConfig(): Promise<AppRuntimeConfig> {
  const snap = await db.collection("appConfig").doc("runtime").get();
  if (!snap.exists) return DEFAULT_APP_RUNTIME_CONFIG;
  const data = snap.data() ?? {};
  return {
    legacyGasDashboardUrl: safeUrl(data.legacyGasDashboardUrl, DEFAULT_APP_RUNTIME_CONFIG.legacyGasDashboardUrl),
    liffSettingsUrl: safeUrl(data.liffSettingsUrl, DEFAULT_APP_RUNTIME_CONFIG.liffSettingsUrl),
    paymentQrImage: safeUrl(data.paymentQrImage, DEFAULT_APP_RUNTIME_CONFIG.paymentQrImage)
  };
}

function buildLiffMealPageUrl(liffSettingsUrl: string, page: "meal-edit" | "leftover" | "meal-delete", mealLogId: string): string {
  const url = new URL(liffSettingsUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/${page}`;
  url.search = "";
  url.searchParams.set("mealId", mealLogId);
  return url.toString();
}

function buildLiffExercisePageUrl(liffSettingsUrl: string, exerciseLogId: string): string {
  const url = new URL(liffSettingsUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/exercise-delete`;
  url.search = "";
  url.searchParams.set("exerciseId", exerciseLogId);
  return url.toString();
}

function buildLiffMealLogUrl(liffSettingsUrl: string, dayKey?: string): string {
  const url = new URL(liffSettingsUrl);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/meal-log`;
  url.search = "";
  if (dayKey) url.searchParams.set("date", dayKey);
  return url.toString();
}

function buildBackdatePromptMessage(mealLogUrl: string, dayLabel: string): LineMessage {
  return {
    type: "flex",
    altText: `บันทึกมื้อย้อนหลัง · ${dayLabel}`,
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "บันทึกมื้อย้อนหลัง", weight: "bold", size: "lg", color: "#146E33" },
          {
            type: "text",
            text: `จะบันทึกเป็นวันที่ ${dayLabel} ครับ พิมพ์ชื่ออาหาร ส่งรูป หรือเปิดหน้าเลือกวันได้เลย (ภายใน 10 นาที)`,
            wrap: true,
            size: "sm",
            color: "#647067"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#146E33",
            height: "sm",
            action: { type: "uri", label: "เปิดหน้าเลือกวัน", uri: mealLogUrl }
          },
          {
            type: "button",
            style: "link",
            color: "#647067",
            height: "sm",
            action: { type: "message", label: "ยกเลิก", text: "ยกเลิกบันทึกย้อนหลัง" }
          }
        ]
      }
    }
  };
}

async function createDashboardAccessUrl(canonicalUserId: string) {
  const token = randomBytes(32).toString("base64url");
  const now = Timestamp.now();
  await db.collection("dashboardAccessSessions").doc(dashboardAccessTokenHash(token)).set({
    canonicalUserId,
    createdAt: now,
    expiresAt: Timestamp.fromMillis(Date.now() + DASHBOARD_ACCESS_TTL_MS)
  });
  return `https://mydietitian.web.app/dashboard?access=${encodeURIComponent(token)}`;
}

function safeUrl(value: unknown, fallback: string) {
  const url = String(value ?? "").trim();
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? url : fallback;
  } catch {
    return fallback;
  }
}

async function getVisibleSubscriptionPlans(): Promise<SubscriptionPlan[]> {
  const snap = await db.collection("subscriptionPlans")
    .orderBy("sortOrder", "asc")
    .get();
  if (snap.empty) return [...DEFAULT_SUBSCRIPTION_PLANS];
  return snap.docs.map((doc) => normalizeSubscriptionPlan(doc.id, doc.data())).filter((plan) => plan.active && plan.visible);
}

async function resolveSubscriptionGrant(input: string | null): Promise<SubscriptionGrant | null> {
  const token = (input ?? DEFAULT_SUBSCRIPTION_PLANS[0].planId).trim().toLowerCase();
  const rawGrant = subscriptionGrantFromRawInput(token);
  if (rawGrant) return rawGrant;

  const planSnap = await db.collection("subscriptionPlans").doc(token).get();
  if (!planSnap.exists) return null;

  const plan = normalizeSubscriptionPlan(planSnap.id, planSnap.data() ?? {});
  if (!plan.active) return null;
  return subscriptionGrantFromPlan(plan);
}

function formatSubscriptionStatus(expiresAt: Timestamp | null, lifetime = false) {
  if (lifetime) return "ไม่มีวันหมดอายุ";
  return expiresAt ? formatBangkokDate(expiresAt.toDate()) : "-";
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
  const message = normalizeSupportText(text.replace(/^(ติดต่อ|แอดมิน|admin)/i, ""), 2000);
  if (!message) {
    await replyToLine(replyToken, "พิมพ์ข้อความต่อท้ายได้เลยครับ เช่น `แอดมิน ขอเปลี่ยนวันเริ่ม`");
    return { forwarded: false, reason: "empty-contact-message" };
  }

  const profile = await getUserProfile(canonicalUserId);
  const ticket = await getOrCreateOpenSupportTicket(
    canonicalUserId,
    lineUserId,
    profile.name
  );
  await appendCustomerSupportMessage(ticket.ticketId, {
    canonicalUserId,
    lineUserId,
    displayName: profile.name,
    text: message
  });

  const adminMessage = [
    "ข้อความลูกค้าใหม่",
    `ชื่อ: ${profile.name}`,
    `Ticket: ${ticket.ticketId}`,
    `ข้อความ: ${message}`,
    "",
    "ตอบกลับที่ Admin Dashboard > ข้อความลูกค้า",
    "https://mydietitian.web.app/admin#support"
  ].join("\n");

  try {
    await pushMessage(ADMIN_LINE_USER_ID.value(), adminMessage);
  } catch (error) {
    await db.collection("adminAuditLogs").add({
      type: "support-admin-notification-failed",
      ticketId: ticket.ticketId,
      error: error instanceof Error ? error.message : String(error),
      createdAt: Timestamp.now()
    });
  }
  await replyToLine(
    replyToken,
    `ส่งข้อความถึงทีมงานแล้วครับ (เคส ${ticket.ticketId.slice(0, 8)})\nเมื่อทีมงานตอบ คุณจะได้รับข้อความใน LINE พร้อมปุ่ม “ตอบแอดมิน”`
  );
  return { forwarded: true, ticketId: ticket.ticketId, created: ticket.created };
}

async function handleSupportReplyControlCommand(
  text: string,
  replyToken: string,
  canonicalUserId: string,
  lineUserId: string
): Promise<Record<string, unknown> | null> {
  const control = parseSupportReplyControl(text);
  if (!control) return null;

  const intentRef = db.collection("supportReplyIntents").doc(canonicalUserId);
  if (control.action === "cancel") {
    await intentRef.delete();
    await replyToLine(replyToken, "ยกเลิกการตอบแอดมินแล้วครับ ข้อความถัดไปจะกลับไปใช้กับบอทตามปกติ");
    return { status: "support-reply-intent-cancelled" };
  }

  const ticketRef = db.collection("supportTickets").doc(control.ticketId);
  const ticketSnap = await ticketRef.get();
  const ticket = ticketSnap.data() ?? {};
  if (!ticketSnap.exists ||
      ticket.status !== "open" ||
      String(ticket.canonicalUserId ?? "") !== canonicalUserId) {
    await replyToLine(replyToken, "ไม่พบเคสที่เปิดอยู่ครับ กรุณาพิมพ์ `แอดมิน` ตามด้วยข้อความเพื่อเปิดเคสใหม่");
    return { status: "support-reply-ticket-not-found" };
  }

  const now = Timestamp.now();
  await intentRef.set({
    canonicalUserId,
    lineUserId,
    ticketId: control.ticketId,
    expiresAt: Timestamp.fromMillis(now.toMillis() + 10 * 60 * 1000),
    createdAt: now,
    updatedAt: now
  });
  await replyToLine(
    replyToken,
    "พร้อมรับข้อความตอบกลับแล้วครับ\nส่งข้อความถัดไป 1 ข้อความภายใน 10 นาที หรือพิมพ์ `ยกเลิกตอบแอดมิน`"
  );
  return { status: "support-reply-intent-set", ticketId: control.ticketId };
}

async function forwardCustomerReplyIfSupportIntent(
  text: string,
  replyToken: string,
  lineUserId: string,
  canonicalUserId: string
): Promise<boolean> {
  const normalizedText = normalizeSupportText(text, 2000);
  if (!normalizedText) return false;

  const intentRef = db.collection("supportReplyIntents").doc(canonicalUserId);
  const forwarded = await db.runTransaction(async (transaction) => {
    const intentSnap = await transaction.get(intentRef);
    if (!intentSnap.exists) return null;

    const intent = intentSnap.data() ?? {};
    const ticketId = String(intent.ticketId ?? "");
    const expiresAt = normalizeTimestamp(intent.expiresAt);
    if (!isSafePublicId(ticketId) || !expiresAt || expiresAt.toMillis() <= Date.now()) {
      transaction.delete(intentRef);
      return null;
    }

    const ticketRef = db.collection("supportTickets").doc(ticketId);
    const ticketSnap = await transaction.get(ticketRef);
    const ticket = ticketSnap.data() ?? {};
    if (!ticketSnap.exists ||
        ticket.status !== "open" ||
        String(ticket.canonicalUserId ?? "") !== canonicalUserId) {
      transaction.delete(intentRef);
      return null;
    }

    const now = Timestamp.now();
    const messageRef = ticketRef.collection("messages").doc();
    transaction.set(messageRef, {
      messageId: messageRef.id,
      direction: "customer-to-admin",
      senderType: "customer",
      senderLabel: String(ticket.displayName ?? "Member"),
      text: normalizedText,
      deliveryStatus: "delivered",
      createdAt: now
    });
    transaction.set(ticketRef, {
      status: "open" satisfies SupportTicketStatus,
      state: "waiting-admin" satisfies SupportTicketState,
      unreadAdmin: FieldValue.increment(1),
      lastMessageText: normalizedText,
      lastMessageDirection: "customer-to-admin",
      lastMessageAt: now,
      lastCustomerReplyAt: now,
      messageCount: FieldValue.increment(1),
      updatedAt: now
    }, { merge: true });
    transaction.delete(intentRef);
    return {
      ticketId,
      displayName: String(ticket.displayName ?? "Member")
    };
  });

  if (!forwarded) return false;

  try {
    await pushMessage(
      ADMIN_LINE_USER_ID.value(),
      `${forwarded.displayName} ตอบกลับเคส ${forwarded.ticketId}\n${normalizedText}\n\nเปิด Inbox: https://mydietitian.web.app/admin#support`
    );
  } catch {
    // The ticket remains safely queued in the dashboard even if the LINE alert fails.
  }
  await replyToLine(replyToken, "ส่งคำตอบให้ทีมงานแล้วครับ ข้อความถัดไปจะกลับไปใช้กับบอทตามปกติ");
  return true;
}

async function getOrCreateOpenSupportTicket(
  canonicalUserId: string,
  lineUserId: string,
  displayName: string
): Promise<{ ticketId: string; created: boolean }> {
  const pointerRef = db.collection("supportTicketPointers").doc(canonicalUserId);
  return db.runTransaction(async (transaction) => {
    const pointerSnap = await transaction.get(pointerRef);
    const activeTicketId = String(pointerSnap.data()?.activeTicketId ?? "");
    if (isSafePublicId(activeTicketId)) {
      const activeRef = db.collection("supportTickets").doc(activeTicketId);
      const activeSnap = await transaction.get(activeRef);
      const active = activeSnap.data() ?? {};
      if (activeSnap.exists &&
          active.status === "open" &&
          String(active.canonicalUserId ?? "") === canonicalUserId) {
        transaction.set(activeRef, {
          lineUserId,
          displayName,
          updatedAt: Timestamp.now()
        }, { merge: true });
        return { ticketId: activeTicketId, created: false };
      }
    }

    const now = Timestamp.now();
    const ticketRef = db.collection("supportTickets").doc();
    transaction.set(ticketRef, {
      ticketId: ticketRef.id,
      canonicalUserId,
      lineUserId,
      displayName,
      status: "open" satisfies SupportTicketStatus,
      state: "waiting-admin" satisfies SupportTicketState,
      unreadAdmin: 0,
      messageCount: 0,
      lastMessageText: "",
      lastMessageDirection: "",
      lastMessageAt: now,
      openedAt: now,
      createdAt: now,
      updatedAt: now
    });
    transaction.set(pointerRef, {
      canonicalUserId,
      lineUserId,
      activeTicketId: ticketRef.id,
      updatedAt: now
    });
    return { ticketId: ticketRef.id, created: true };
  });
}

async function appendCustomerSupportMessage(
  ticketId: string,
  input: {
    canonicalUserId: string;
    lineUserId: string;
    displayName: string;
    text: string;
  }
): Promise<void> {
  const ticketRef = db.collection("supportTickets").doc(ticketId);
  await db.runTransaction(async (transaction) => {
    const ticketSnap = await transaction.get(ticketRef);
    if (!ticketSnap.exists || ticketSnap.data()?.status !== "open") {
      throw new Error("support-ticket-not-open");
    }
    const now = Timestamp.now();
    const messageRef = ticketRef.collection("messages").doc();
    transaction.set(messageRef, {
      messageId: messageRef.id,
      direction: "customer-to-admin",
      senderType: "customer",
      senderLabel: input.displayName,
      text: input.text,
      deliveryStatus: "delivered",
      createdAt: now
    });
    transaction.set(ticketRef, {
      canonicalUserId: input.canonicalUserId,
      lineUserId: input.lineUserId,
      displayName: input.displayName,
      status: "open" satisfies SupportTicketStatus,
      state: "waiting-admin" satisfies SupportTicketState,
      unreadAdmin: FieldValue.increment(1),
      lastMessageText: input.text,
      lastMessageDirection: "customer-to-admin",
      lastMessageAt: now,
      lastCustomerReplyAt: now,
      messageCount: FieldValue.increment(1),
      updatedAt: now
    }, { merge: true });
  });
}

async function getUserReadiness(userId: string): Promise<UserReadiness> {
  const [profileSnap, subscriptionState] = await Promise.all([
    db.collection("profiles").doc(userId).get(),
    getSubscriptionState(userId)
  ]);
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const target = resolveEffectiveTarget(profile);
  return {
    profileComplete: Boolean(profileSnap.exists && target.cal > 0 && target.p > 0 && target.c > 0 && target.f > 0),
    subscriptionActive: subscriptionState.active,
    expiresAt: subscriptionState.expiresAt
  };
}

async function getUserProfile(userId: string): Promise<UserProfile> {
  const [profileSnap, subscriptionState] = await Promise.all([
    db.collection("profiles").doc(userId).get(),
    getSubscriptionState(userId)
  ]);
  const profile = profileSnap.exists ? profileSnap.data() ?? {} : {};
  const target = resolveEffectiveTarget(profile);

  return {
    name: String(profile.displayName ?? profile.name ?? "Member"),
    target: {
      cal: target.cal || 2000,
      p: target.p || 100,
      c: target.c || 200,
      f: target.f || 60,
      fib: target.fib || 25
    },
    program: target.program
      ? {
          type: target.program.type,
          week: target.program.week,
          weeks: target.program.weeks,
          adjustMacro: target.program.adjustMacro,
          status: target.program.status
        }
      : null,
    expiresAt: subscriptionState.expiresAt ?? normalizeTimestamp(profile.expiresAt),
    lifetime: subscriptionState.lifetime || Boolean(profile.lifetime),
    streak: normalizeStreak(profile)
  };
}

async function getTodaySummary(userId: string, profile: UserProfile): Promise<TodaySummary> {
  return getDaySummary(userId, profile, new Date());
}

async function getDaySummary(userId: string, profile: UserProfile, day: Date): Promise<TodaySummary> {
  const { startDate, endDate } = getBangkokDayRange(day);
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
  const meals: Array<{ name: string; kcal: number }> = [];
  mealSnap.forEach((doc) => {
    const data = doc.data();
    const nutrients = data.nutrients ?? {};
    const kcal = Math.round(Number(nutrients.caloriesKcal ?? 0));
    consumed.cal += kcal;
    consumed.p += Number(nutrients.proteinG ?? 0);
    consumed.c += Number(nutrients.carbsG ?? 0);
    consumed.f += Number(nutrients.fatG ?? 0);
    consumed.fib += Number(nutrients.fiberG ?? 0);
    meals.push({
      name: String(data.mealNameTh ?? data.mealNameEn ?? "มื้ออาหาร"),
      kcal
    });
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
    },
    meals: meals.slice(-3).reverse()
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
  return /ดีไหม|ควร|ไหม|มั้ย|ได้ไหม|ได้มั้ย|ถาม|ปรึกษา|แนะนำ|ช่วยแนะนำ|ลดน้ำหนัก|เพิ่มกล้าม|คุมอาหาร|ยังไง|ยังงัย|อย่างไร|ทำไง|วิธี|\?/.test(text) ||
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

// Detects a correction of the latest meal ("ไม่ใช่ X แต่เป็น Y", "คือ X ไม่ใช่ Y",
// "แก้เป็น ...", etc.) and returns the user's FULL cleaned sentence. We pass the
// whole sentence downstream (not a regex-extracted fragment) so the analysis can
// reconcile it against the original photo — extracting a single word here is
// what previously grabbed the NEGATED item (e.g. "ไม่ใช่น้ำตาล" -> "น้ำตาล").
function parseMealCorrectionText(text: string): string | null {
  const trimmed = text.trim();
  const isCorrection =
    /(?:ไม่ใช่|ผิด|แก้เป็น|เปลี่ยนเป็น|จริงๆ|จริง ๆ)/.test(trimmed) ||
    /(?:^|\s)(?:not|wrong|actually|change to|correct to|it is)\b/i.test(trimmed);
  if (!isCorrection) return null;

  const cleaned = trimmed.replace(/[\s,]*(ครับ|ค่ะ|คับ|จ้า|นะ|น่ะ|ค่า)\s*$/i, "").trim();
  if (cleaned.length < 4) return null;
  return cleaned;
}

type LiffMealOwner = { canonicalUserId: string; lineUserId: string };
type MealLogSnapshot = DocumentSnapshot;
type ExerciseLogSnapshot = DocumentSnapshot;

async function resolveLiffMealOwner(
  request: Parameters<Parameters<typeof onRequest>[0]>[0],
  body: { userId?: string; lineUserId?: string; canonicalUserId?: string; firebaseAuthUid?: string }
): Promise<LiffMealOwner> {
  if (!body?.userId || !isSafePublicId(body.userId)) {
    throw new LiffMealValidationError("invalid userId");
  }
  if (body.lineUserId && !isSafePublicId(body.lineUserId)) throw new LiffMealValidationError("invalid lineUserId");
  if (body.canonicalUserId && !isSafePublicId(body.canonicalUserId)) throw new LiffMealValidationError("invalid canonicalUserId");
  if (body.firebaseAuthUid && !isSafePublicId(body.firebaseAuthUid)) throw new LiffMealValidationError("invalid firebaseAuthUid");

  const owner = await verifyProfileOwnership(request, {
    userId: body.userId,
    lineUserId: body.lineUserId,
    canonicalUserId: body.canonicalUserId,
    firebaseAuthUid: body.firebaseAuthUid
  });
  if (!owner.verified || !owner.canonicalUserId || !owner.lineUserId) {
    throw new ProfileAuthError("missing verified LINE owner");
  }
  return { canonicalUserId: owner.canonicalUserId, lineUserId: owner.lineUserId };
}

function respondToLiffMealError(
  response: Parameters<Parameters<typeof onRequest>[0]>[1],
  error: unknown
) {
  if (error instanceof ProfileAuthError) {
    sendProfileAuthError(response, error);
    return;
  }
  if (error instanceof LiffMealValidationError) {
    response.status(400).json({ ok: false, error: "invalid-liff-meal-request", message: error.message });
    return;
  }
  response.status(500).json({
    ok: false,
    error: "liff-meal-request-failed",
    message: error instanceof Error ? error.message : String(error)
  });
}

async function getOwnedMealLog(userId: string, mealLogId: string): Promise<MealLogSnapshot | null> {
  if (!isSafePublicId(mealLogId)) throw new LiffMealValidationError("invalid mealLogId");
  const meal = await db.collection("mealLogs").doc(mealLogId).get();
  if (!meal.exists || String(meal.data()?.userId ?? "") !== userId) return null;
  return meal;
}

async function getOwnedExerciseLog(userId: string, exerciseLogId: string): Promise<ExerciseLogSnapshot | null> {
  if (!isSafePublicId(exerciseLogId)) throw new LiffMealValidationError("invalid exerciseLogId");
  const exercise = await db.collection("exerciseLogs").doc(exerciseLogId).get();
  if (!exercise.exists || String(exercise.data()?.userId ?? "") !== userId) return null;
  return exercise;
}

function serializeMealForLiff(mealLogId: string, data: Record<string, unknown>) {
  const nutrients = (data.nutrients ?? {}) as Record<string, unknown>;
  return {
    id: mealLogId,
    mealNameTh: String(data.mealNameTh ?? data.mealNameEn ?? "มื้ออาหาร"),
    mealNameEn: String(data.mealNameEn ?? ""),
    portionDescription: String(data.portionDescription ?? ""),
    inputType: data.inputType === "image" ? "image" : "text",
    originalText: data.inputType === "text" ? String(data.text ?? "") : "",
    nutrients: {
      caloriesKcal: Math.round(Number(nutrients.caloriesKcal ?? 0)),
      proteinG: Math.round(Number(nutrients.proteinG ?? 0)),
      carbsG: Math.round(Number(nutrients.carbsG ?? 0)),
      fatG: Math.round(Number(nutrients.fatG ?? 0)),
      fiberG: Number(Number(nutrients.fiberG ?? 0).toFixed(1))
    }
  };
}

function serializeExerciseForLiff(exerciseLogId: string, data: Record<string, unknown>) {
  return {
    id: exerciseLogId,
    activityName: String(data.activityName ?? data.exerciseName ?? "ออกกำลังกาย"),
    rawCaloriesBurned: Math.max(0, Math.round(Number(data.rawCaloriesBurned ?? data.caloriesBurned ?? 0))),
    caloriesBurned: Math.max(0, Math.round(Number(data.caloriesBurned ?? 0))),
    safetyFactor: Number(data.safetyFactor ?? 0.5),
    commentTh: String(data.commentTh ?? "")
  };
}

function normalizeLiffCorrectionText(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (text.length < 2 || text.length > 600) throw new LiffMealValidationError("correctionText must be 2-600 characters");
  return text;
}

function liffPortionAdjustment(value: unknown): { ratio: number; label: string } | null {
  const ratio = Number(value);
  const allowed = [1, 0.75, 0.5, 0.25];
  if (!allowed.includes(ratio)) return null;
  const label = ratio === 1 ? "100% (หมดจาน)" : `${Math.round(ratio * 100)}%`;
  return { ratio, label };
}

function validateLiffImage(value: unknown): string {
  const base64 = String(value ?? "").replace(/^data:[^,]+,/, "").trim();
  // The LIFF client compresses before upload. Keep the payload bounded here as
  // a second line of defence against accidental huge camera files.
  if (!base64 || base64.length > 2_800_000 || !/^[A-Za-z0-9+/=]+$/.test(base64)) {
    throw new LiffMealValidationError("invalid or oversized image");
  }
  return base64;
}

function validateLiffImageMimeType(value: unknown): string {
  const mimeType = String(value ?? "").toLowerCase();
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new LiffMealValidationError("unsupported image type");
  }
  return mimeType;
}

// "Latest" means the meal the user most recently sent, so order by createdAt:
// a backdated meal carries an old loggedAt but is still the one follow-up
// commands (portion, leftover, correction) refer to. Migrated GAS meals have
// createdAt = loggedAt, so the ordering is unchanged for them.
async function getLatestMealLog(userId: string) {
  const snap = await db.collection("mealLogs")
    .where("userId", "==", userId)
    .orderBy("createdAt", "desc")
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

  return adjustMealPortion(doc, adjustment, commandText);
}

async function adjustMealPortion(
  doc: MealLogSnapshot,
  adjustment: { ratio: number; label: string },
  commandText: string
): Promise<{ adjusted: boolean; message: string }> {
  const data = doc.data();
  if (!data) return { adjusted: false, message: "ไม่พบรายการอาหารให้ปรับปริมาณครับ" };
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
      "ปรับปริมาณรายการเรียบร้อยครับ",
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
  const primaryProvider = agent.provider;
  const primaryModel = agent.model;

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
      getAiProviderApiKeys(),
      agent
    );
    const fallbackUsed = didUseAiFallback(agent, primaryProvider, primaryModel);
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
        primaryProvider,
        primaryModel,
        provider: agent.provider,
        model: agent.model,
        fallbackUsed,
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

function normalizeLeftoverNutrients(leftover: Awaited<ReturnType<typeof callGeminiLeftoverAnalysis>>["nutrients"]) {
  return {
    caloriesKcal: Math.max(0, Math.round(Number(leftover?.calories_kcal ?? 0))),
    proteinG: Math.max(0, Math.round(Number(leftover?.protein_g ?? 0))),
    carbsG: Math.max(0, Math.round(Number(leftover?.carbs_g ?? 0))),
    fatG: Math.max(0, Math.round(Number(leftover?.fat_g ?? 0))),
    fiberG: Math.max(0, Number(Number(leftover?.fiber_g ?? 0).toFixed(1))),
    sugarG: Math.max(0, Number(Number(leftover?.sugar_g ?? 0).toFixed(1)))
  };
}

function subtractNutrients(
  nutrients: Record<string, unknown>,
  leftover: ReturnType<typeof normalizeLeftoverNutrients>
) {
  return {
    caloriesKcal: Math.max(0, Math.round(Number(nutrients.caloriesKcal ?? 0) - leftover.caloriesKcal)),
    proteinG: Math.max(0, Math.round(Number(nutrients.proteinG ?? 0) - leftover.proteinG)),
    carbsG: Math.max(0, Math.round(Number(nutrients.carbsG ?? 0) - leftover.carbsG)),
    fatG: Math.max(0, Math.round(Number(nutrients.fatG ?? 0) - leftover.fatG)),
    fiberG: Math.max(0, Number((Number(nutrients.fiberG ?? 0) - leftover.fiberG).toFixed(1))),
    sugarG: Math.max(0, Number((Number(nutrients.sugarG ?? 0) - leftover.sugarG).toFixed(1)))
  };
}

async function createLiffLeftoverPreview(input: {
  canonicalUserId: string;
  lineUserId: string;
  meal: MealLogSnapshot;
  imageBase64: string;
  mimeType: string;
}) {
  const mealData = input.meal.data();
  if (!mealData) throw new LiffMealValidationError("meal not found");
  const mealName = String(mealData.mealNameTh ?? mealData.mealNameEn ?? "มื้ออาหาร");
  const agent = await getAiAgentConfig("mealAnalysis");
  if (!agent.enabled) throw new Error("AI mealAnalysis agent is disabled");

  const previewRef = db.collection("leftoverPreviews").doc();
  const aiRunRef = db.collection("aiRuns").doc();
  const now = Timestamp.now();
  await aiRunRef.set({
    runId: aiRunRef.id,
    userId: input.canonicalUserId,
    canonicalUserId: input.canonicalUserId,
    lineUserId: input.lineUserId,
    source: "line",
    inputType: "leftover_liff_preview",
    imageUrl: `liff-upload://${previewRef.id}`,
    status: "running",
    createdAt: now,
    agentId: agent.agentId,
    provider: agent.provider,
    promptVersion: agent.promptVersion,
    model: agent.model
  });

  try {
    const leftover = await callGeminiLeftoverAnalysis(
      { imageBase64: input.imageBase64, mimeType: input.mimeType, latestMealName: mealName },
      getAiProviderApiKeys(),
      agent
    );
    const leftoverNutrients = normalizeLeftoverNutrients(leftover.nutrients);
    const currentNutrients = (mealData.nutrients ?? {}) as Record<string, unknown>;
    const estimatedAfter = subtractNutrients(currentNutrients, leftoverNutrients);
    const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
    const savedAt = Timestamp.now();
    await previewRef.set({
      previewId: previewRef.id,
      canonicalUserId: input.canonicalUserId,
      lineUserId: input.lineUserId,
      mealLogId: input.meal.id,
      mealNameTh: mealName,
      leftoverNameTh: leftover.dish_name?.th ?? "ของเหลือ",
      portionDescription: leftover.portion_description ?? "",
      leftoverNutrients,
      estimatedAfter,
      aiRunId: aiRunRef.id,
      createdAt: savedAt,
      expiresAt,
      confirmedAt: null
    });
    await aiRunRef.set({
      status: "completed",
      mealLogId: input.meal.id,
      completedAt: savedAt,
      output: leftover
    }, { merge: true });

    return {
      previewId: previewRef.id,
      mealNameTh: mealName,
      leftoverNameTh: leftover.dish_name?.th ?? "ของเหลือ",
      portionDescription: String(leftover.portion_description ?? ""),
      subtract: leftoverNutrients,
      after: estimatedAfter,
      expiresAt: expiresAt.toDate().toISOString()
    };
  } catch (error) {
    await aiRunRef.set({
      status: "failed",
      failedAt: Timestamp.now(),
      error: error instanceof Error ? error.message : String(error)
    }, { merge: true });
    throw error;
  }
}

async function confirmLiffLeftoverPreview(canonicalUserId: string, previewId: string) {
  if (!isSafePublicId(previewId)) throw new LiffMealValidationError("invalid previewId");
  const previewRef = db.collection("leftoverPreviews").doc(previewId);
  const result = await db.runTransaction(async (transaction) => {
    const previewSnap = await transaction.get(previewRef);
    const preview = previewSnap.exists ? previewSnap.data() ?? {} : null;
    if (!preview || String(preview.canonicalUserId ?? "") !== canonicalUserId) {
      throw new LiffMealValidationError("leftover preview not found");
    }
    if (preview.confirmedAt) throw new LiffMealValidationError("leftover preview already confirmed");
    const expiresAt = preview.expiresAt instanceof Timestamp ? preview.expiresAt.toMillis() : 0;
    if (!expiresAt || expiresAt < Date.now()) throw new LiffMealValidationError("leftover preview expired");

    const mealRef = db.collection("mealLogs").doc(String(preview.mealLogId));
    const mealSnap = await transaction.get(mealRef);
    const mealData = mealSnap.exists ? mealSnap.data() ?? {} : null;
    if (!mealData || String(mealData.userId ?? "") !== canonicalUserId) {
      throw new LiffMealValidationError("meal no longer exists");
    }
    const nutrients = (mealData.nutrients ?? {}) as Record<string, unknown>;
    const leftoverNutrients = preview.leftoverNutrients as ReturnType<typeof normalizeLeftoverNutrients>;
    const updatedNutrients = subtractNutrients(nutrients, leftoverNutrients);
    const originalName = String(mealData.mealNameTh ?? mealData.mealNameEn ?? "มื้ออาหาร");
    const previousAdjustments = Array.isArray(mealData.adjustments) ? mealData.adjustments : [];
    const now = Timestamp.now();

    transaction.set(mealRef, {
      mealNameTh: `${originalName.replace(/\s*\([^)]*\)\s*$/, "")} (หัก: ${String(preview.leftoverNameTh ?? "ของเหลือ")})`,
      nutrients: updatedNutrients,
      adjustments: [...previousAdjustments, {
        type: "leftover-subtraction",
        source: "liff",
        previewId,
        leftoverNameTh: preview.leftoverNameTh ?? "ของเหลือ",
        portionDescription: preview.portionDescription ?? "",
        subtractedNutrients: leftoverNutrients,
        previousNutrients: nutrients,
        aiRunId: preview.aiRunId ?? null,
        adjustedAt: now
      }],
      updatedAt: now
    }, { merge: true });
    transaction.update(previewRef, { confirmedAt: now, updatedAt: now, appliedNutrients: updatedNutrients });
    return { mealLogId: mealRef.id, mealNameTh: originalName, subtract: leftoverNutrients, after: updatedNutrients };
  });
  return result;
}

function parseLineMessageId(imageUrl: unknown): string | null {
  const match = String(imageUrl ?? "").match(/^line-message:\/\/(.+)$/);
  return match ? match[1] : null;
}

// Re-download the original LINE photo and re-analyse it, passing the user's full
// correction as authoritative context so the model reconciles it against the
// image (dish name, condiments, and macros). Returns null (so the caller can
// fall back to text-only) if the LINE content has expired or any step fails.
async function reanalyzeCorrectionFromImage(
  userId: string,
  messageId: string,
  userCorrection: string,
  existingMeal?: MealLogSnapshot
): Promise<SavedMealAnalysis | null> {
  try {
    const content = await downloadLineContent(messageId);
    return await analyzeAndSaveMeal({
      userId,
      canonicalUserId: userId,
      source: "line",
      inputType: "image",
      imageUrl: `line-message://${messageId}`,
      imageBase64: content.base64,
      mimeType: content.mimeType,
      userCorrection
    }, existingMeal);
  } catch (error) {
    await db.collection("adminAuditLogs").add({
      type: "meal-correction-image-refetch-failed",
      messageId,
      error: error instanceof Error ? error.message : String(error),
      createdAt: Timestamp.now()
    });
    return null;
  }
}

async function replaceLatestMealWithCorrection(
  userId: string,
  correctedText: string,
  originalCommandText: string,
  selectedMeal?: MealLogSnapshot
): Promise<{ corrected: boolean; message: string; runId?: string; mealLogId?: string }> {
  const latest = selectedMeal ?? await getLatestMealLog(userId);
  if (!latest) {
    return { corrected: false, message: "ไม่พบรายการอาหารให้แก้ไขครับ" };
  }

  const previousData = latest.data();
  if (!previousData) return { corrected: false, message: "ไม่พบข้อมูลรายการอาหารให้แก้ไขครับ" };

  // Prefer re-analysing the ORIGINAL photo (portion + side items stay intact),
  // anchoring identity to the user's correction. Fall back to text-only when the
  // original was not an image or the LINE content is no longer downloadable.
  const originalMessageId = previousData.inputType === "image"
    ? parseLineMessageId(previousData.imageUrl)
    : null;
  const imageSaved = originalMessageId
    ? await reanalyzeCorrectionFromImage(userId, originalMessageId, correctedText, latest)
    : null;
  // Text fallback (image expired / original was text): analyse the correction
  // sentence and flag it as a correction so the prompt reconciles it.
  const saved = imageSaved ?? await analyzeAndSaveMeal({
    userId,
    canonicalUserId: userId,
    source: "line",
    inputType: "text",
    text: correctedText,
    userCorrection: correctedText
  }, latest);
  const now = Timestamp.now();
  const correctionHistory = Array.isArray(previousData.correctionHistory) ? previousData.correctionHistory : [];
  await latest.ref.set(
    {
      correction: {
        type: selectedMeal ? "update-selected-in-place" : "update-latest-in-place",
        originalMealLogId: latest.id,
        originalMealNameTh: previousData.mealNameTh ?? null,
        originalMealNameEn: previousData.mealNameEn ?? null,
        originalCommandText,
        correctedText,
        correctedAt: now
      },
      correctionHistory: [...correctionHistory, {
        originalMealNameTh: previousData.mealNameTh ?? null,
        originalMealNameEn: previousData.mealNameEn ?? null,
        previousNutrients: previousData.nutrients ?? null,
        originalCommandText,
        correctedText,
        correctedAt: now,
        aiRunId: saved.runId
      }],
      updatedAt: now
    },
    { merge: true }
  );

  const correctedMeal = saved.mealLog as Record<string, unknown>;
  const nutrients = correctedMeal.nutrients as Record<string, unknown> | undefined;
  return {
    corrected: true,
    runId: saved.runId,
    mealLogId: latest.id,
    message: [
      "แก้ไขรายการเรียบร้อยครับ",
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
  // "ลบ/ยกเลิก" undoes the meal just sent — including a backdated one — so it
  // shares getLatestMealLog's createdAt ordering.
  const doc = await getLatestMealLog(userId);
  if (!doc) {
    return { deleted: false, message: "ไม่พบรายการอาหารของคุณในประวัติครับ" };
  }

  const data = doc.data();
  await doc.ref.delete();
  return {
    deleted: true,
    message: `ลบรายการล่าสุด: ${data.mealNameTh ?? data.mealNameEn ?? "รายการอาหาร"} เรียบร้อย`
  };
}

async function deleteLastExerciseLog(userId: string): Promise<{
  deleted: boolean;
  message: string;
  exerciseLogId?: string;
}> {
  const snap = await db.collection("exerciseLogs")
    .where("userId", "==", userId)
    .orderBy("loggedAt", "desc")
    .limit(1)
    .get();

  if (snap.empty) {
    return { deleted: false, message: "ไม่พบรายการออกกำลังกายของคุณในประวัติครับ" };
  }

  const doc = snap.docs[0];
  const data = doc.data();
  const activityName = String(data.activityName ?? data.exerciseName ?? "ออกกำลังกาย");
  const caloriesBurned = Math.max(0, Math.round(Number(data.caloriesBurned ?? 0)));
  const eventRef = db.collection("profileEvents").doc();
  const batch = db.batch();
  batch.delete(doc.ref);
  batch.set(eventRef, {
    type: "exercise-delete-from-chat",
    canonicalUserId: userId,
    exerciseLogId: doc.id,
    activityName,
    caloriesBurned,
    deletedAt: Timestamp.now()
  });
  await batch.commit();
  return {
    deleted: true,
    exerciseLogId: doc.id,
    message: `ลบกิจกรรมล่าสุด: ${activityName} และนำโควต้าที่เพิ่ม ${caloriesBurned} kcal ออกแล้วครับ`
  };
}

function formatProfileReply(profile: UserProfile): string {
  const expireText = formatSubscriptionStatus(profile.expiresAt ?? null, Boolean(profile.lifetime));
  return [
    `ข้อมูลส่วนตัว (${profile.name})`,
    `หมดอายุ: ${expireText}`,
    `TDEE: ${Math.round(profile.target.cal)} kcal`,
    `P:${Math.round(profile.target.p)} C:${Math.round(profile.target.c)} F:${Math.round(profile.target.f)} Fib:${Math.round(profile.target.fib)}`
  ].join("\n");
}

function formatDailySummaryReply(profile: UserProfile, summary: TodaySummary): string {
  const target = Math.round(summary.dynamicTarget);
  const consumed = Math.round(summary.consumed.cal);
  const remaining = Math.round(summary.remaining.cal);
  const over = consumed > target;
  return [
    `สรุปวันนี้ (${profile.name})`,
    over
      ? `กินแล้ว ${consumed} / ${target} kcal (เกิน ${Math.abs(remaining)} kcal)`
      : remaining <= 0
        ? `กินแล้ว ${consumed} / ${target} kcal (ครบเป้าแล้ว)`
        : `กินแล้ว ${consumed} / ${target} kcal (เหลือ ${remaining} kcal)`,
    `โปรตีน ${Math.round(summary.consumed.p)}g · คาร์บ ${Math.round(summary.consumed.c)}g · ไขมัน ${Math.round(summary.consumed.f)}g · ไฟเบอร์ ${summary.consumed.fib.toFixed(1)}g`
  ].join("\n");
}

// Customer-facing Flex tokens — aligned with apps/liff/DESIGN.md
const FLEX_CUSTOMER = {
  green: "#1F8A43",
  greenDeep: "#146E33",
  orange: "#E5861C",
  orangeDeep: "#C76A12",
  ink: "#1F2937",
  inkSoft: "#55605A",
  muted: "#7A8088",
  track: "#EDF1EF",
  surface: "#FFFFFF",
  tint: "#F4F8F5",
  chipGreen: "#E1F2E7",
  danger: "#E0533F",
  streakBg: "#FFF3E0",
  streakText: "#C76A12",
  // Macro bar palette — semantic + collision-free. Calorie bars own green,
  // danger owns red, so macros use blue/amber/violet/teal (protein=blue and
  // carb=amber follow tracker convention; fat=violet avoids clashing with the
  // danger red; fiber=teal reads as "vegetable" without colliding with brand green).
  protein: "#2F6DB5",
  carb: "#F2A93B",
  fat: "#845EF7",
  fiber: "#149E8E",
  headerSub: "#D6F7EC"
} as const;

// Help-guide icon set: white line icons on transparent, hosted on Firebase.
// Source SVGs + build script: tools/build-icons.mjs (npm run icons:build).
// The solid green chip is drawn by Flex; the PNG is white-on-transparent.
const ICON_BASE = "https://mydietitian.web.app/assets/icons";

function isExerciseRecommendationRequest(text: string): boolean {
  return text === "แนะนำออกกำลังกายวันนี้" || text === "ออกกำลังกายวันนี้";
}

function dailySummaryEncouragementText(
  dayTarget: number,
  dayConsumed: number,
  dayRemaining: number,
  overTarget: boolean,
  streakCount: number
): string {
  if (overTarget) {
    return `วันนี้เกินไป ${Math.abs(dayRemaining)} kcal — พรุ่งนี้ปรับนิดเดียวก็ได้`;
  }
  if (dayRemaining <= 0) {
    return streakCount > 1
      ? `ครบเป้าวันนี้แล้ว — ติดต่อกัน ${streakCount} วัน เก่งมาก`
      : "ครบเป้าวันนี้แล้ว — ทำได้ดีมาก";
  }
  if (dayRemaining <= Math.round(dayTarget * 0.15)) {
    return `ใกล้ครบเป้าแล้ว เหลืออีก ${dayRemaining} kcal`;
  }
  if (dayConsumed === 0) {
    return `เป้าวันนี้ ${dayTarget} kcal — เริ่มบันทึกมื้อแรกได้เลย`;
  }
  return `ยังกินได้อีก ${dayRemaining} kcal`;
}

const DAILY_SUMMARY_HUB = {
  menu: { label: "แนะนำเมนูวันนี้", text: "กินไรดี" },
  exercise: { label: "แนะนำออกกำลังกาย", text: "แนะนำออกกำลังกายวันนี้" },
  coach: { label: "ปรึกษาโค้ช", text: "ปรึกษาโค้ช" },
  status: { label: "ดูวันคงเหลือ", text: "เช็คสถานะ" },
  renew: { label: "ต่ออายุแพ็กเกจ", text: "เติมวัน" }
} as const;

function flexMealRow(name: string, kcal: number): Record<string, unknown> {
  return {
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    paddingTop: "10px",
    paddingBottom: "2px",
    contents: [
      { type: "text", text: name, size: "sm", color: FLEX_CUSTOMER.ink, flex: 1, wrap: true, maxLines: 2 },
      { type: "text", text: `${kcal} kcal`, size: "sm", weight: "bold", color: FLEX_CUSTOMER.greenDeep, flex: 0, align: "end" }
    ]
  };
}

// Rich "hub" card for the สรุป command: today's progress plus quick-action
// buttons to the dashboard, AI menu/coach, exercise advice, status, and top-up.
function buildDailySummaryFlexMessage(profile: UserProfile, summary: TodaySummary, dashboardUrl: string): LineMessage {
  const dayTarget = Math.round(summary.dynamicTarget);
  const dayConsumed = Math.round(summary.consumed.cal);
  const dayRemaining = Math.round(summary.remaining.cal);
  const overTarget = dayConsumed > dayTarget;
  const streakCount = profile.streak?.count ?? 0;

  const macroRow = (label: string, consumed: number, remaining: number, color: string) => {
    const target = Math.round(consumed + remaining);
    return flexMacroRow(label, `${Math.round(consumed)} / ${target}g`, target ? (consumed / target) * 100 : 0, color);
  };

  const headerContents: Array<Record<string, unknown>> = [
    { type: "text", text: "สรุปวันนี้", weight: "bold", size: "lg", color: "#FFFFFF" },
    { type: "text", text: profile.name, size: "sm", color: FLEX_CUSTOMER.headerSub, margin: "sm" }
  ];

  if (streakCount > 1) {
    headerContents.push({
      type: "box",
      layout: "horizontal",
      backgroundColor: FLEX_CUSTOMER.streakBg,
      cornerRadius: "999px",
      paddingAll: "6px",
      paddingStart: "12px",
      paddingEnd: "12px",
      margin: "md",
      contents: [
        {
          type: "text",
          text: `ติดต่อกัน ${streakCount} วันแล้ว`,
          size: "xs",
          weight: "bold",
          color: FLEX_CUSTOMER.streakText,
          align: "center"
        }
      ]
    });
  }

  if (profile.program && profile.program.status === "active") {
    const macroLabelTh = PROGRAM_MACRO_LABEL_TH[profile.program.adjustMacro];
    headerContents.push({
      type: "text",
      text: `${profile.program.type === "cut" ? "CUT" : "Bulk"} · สัปดาห์ ${profile.program.week}/${profile.program.weeks} · ปรับ${macroLabelTh}`,
      size: "xs",
      color: "#FFFFFF",
      margin: "sm"
    });
  }

  const encouragementText = dailySummaryEncouragementText(
    dayTarget,
    dayConsumed,
    dayRemaining,
    overTarget,
    streakCount
  );

  const bodyContents: Array<Record<string, unknown>> = [
    {
      type: "box",
      layout: "baseline",
      contents: [
        {
          type: "text",
          text: `${dayConsumed}`,
          size: "xxl",
          weight: "bold",
          color: overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.ink,
          flex: 0
        },
        {
          type: "text",
          text: `/ ${dayTarget} kcal`,
          size: "sm",
          color: FLEX_CUSTOMER.muted,
          margin: "sm",
          flex: 0
        }
      ]
    },
    flexProgressBar(dayTarget ? (dayConsumed / dayTarget) * 100 : 0, overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.green),
    {
      type: "text",
      text: encouragementText,
      size: "sm",
      weight: "bold",
      color: overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.greenDeep,
      margin: "sm",
      wrap: true
    }
  ];

  if (summary.burned > 0) {
    bodyContents.push({
      type: "text",
      text: `ออกกำลังกายวันนี้ เพิ่มโควต้า +${Math.round(summary.burned)} kcal`,
      size: "xs",
      color: FLEX_CUSTOMER.muted,
      margin: "sm"
    });
  }

  bodyContents.push(
    { type: "separator", margin: "lg" },
    macroRow("โปรตีน", summary.consumed.p, summary.remaining.p, FLEX_CUSTOMER.protein),
    macroRow("คาร์บ", summary.consumed.c, summary.remaining.c, FLEX_CUSTOMER.carb),
    macroRow("ไขมัน", summary.consumed.f, summary.remaining.f, FLEX_CUSTOMER.fat),
    macroRow("ไฟเบอร์", summary.consumed.fib, summary.remaining.fib, FLEX_CUSTOMER.fiber),
    { type: "separator", margin: "lg" },
    { type: "text", text: "มื้อที่บันทึกแล้ว", size: "sm", weight: "bold", color: FLEX_CUSTOMER.ink, margin: "none" }
  );

  if (summary.meals.length === 0) {
    bodyContents.push({
      type: "text",
      text: "ยังไม่บันทึกมื้อวันนี้ — ส่งรูปอาหารหรือพิมพ์ชื่อเมนูมาได้เลย",
      size: "sm",
      color: FLEX_CUSTOMER.muted,
      margin: "md",
      wrap: true
    });
  } else {
    summary.meals.forEach((meal, index) => {
      if (index > 0) bodyContents.push({ type: "separator", margin: "sm" });
      bodyContents.push(flexMealRow(meal.name, meal.kcal));
    });
  }

  const msgBtn = (label: string, text: string, flex = 1): Record<string, unknown> => ({
    type: "button",
    style: "secondary",
    height: "sm",
    flex,
    action: { type: "message", label, text }
  });
  const row = (...buttons: Array<Record<string, unknown>>): Record<string, unknown> => ({
    type: "box",
    layout: "horizontal",
    spacing: "sm",
    contents: buttons
  });

  const footerContents: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: "ขั้นตอนถัดไป",
      size: "xs",
      color: FLEX_CUSTOMER.muted,
      margin: "none"
    },
    {
      type: "button",
      style: "primary",
      color: FLEX_CUSTOMER.green,
      height: "sm",
      action: { type: "uri", label: "เปิดแดชบอร์ด", uri: dashboardUrl }
    },
    row(
      msgBtn(DAILY_SUMMARY_HUB.menu.label, DAILY_SUMMARY_HUB.menu.text),
      msgBtn(DAILY_SUMMARY_HUB.exercise.label, DAILY_SUMMARY_HUB.exercise.text)
    ),
    row(
      msgBtn(DAILY_SUMMARY_HUB.coach.label, DAILY_SUMMARY_HUB.coach.text),
      msgBtn(DAILY_SUMMARY_HUB.status.label, DAILY_SUMMARY_HUB.status.text)
    ),
    {
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "message", label: DAILY_SUMMARY_HUB.renew.label, text: DAILY_SUMMARY_HUB.renew.text }
    }
  ];

  return {
    type: "flex",
    altText: formatDailySummaryReply(profile, summary).slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.green,
        paddingAll: "16px",
        contents: headerContents
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.surface,
        paddingAll: "16px",
        contents: bodyContents
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", paddingAll: "12px", contents: footerContents }
    }
  };
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

async function buildExerciseCardMessage(
  canonicalUserId: string,
  exerciseLog: Record<string, unknown>,
  summary: TodaySummary
): Promise<LineMessage> {
  const [appConfig, dashboardUrl] = await Promise.all([
    getAppRuntimeConfig(),
    createDashboardAccessUrl(canonicalUserId)
  ]);
  const exerciseLogId = String(exerciseLog.id ?? "");
  const deleteUrl = exerciseLogId
    ? buildLiffExercisePageUrl(appConfig.liffSettingsUrl, exerciseLogId)
    : "";
  const activityName = String(exerciseLog.activityName ?? "ออกกำลังกาย");
  const rawCaloriesBurned = Math.max(0, Math.round(Number(exerciseLog.rawCaloriesBurned ?? 0)));
  const caloriesBurned = Math.max(0, Math.round(Number(exerciseLog.caloriesBurned ?? 0)));
  const dayTarget = Math.round(summary.dynamicTarget);
  const dayConsumed = Math.round(summary.consumed.cal);
  const dayRemaining = Math.round(summary.remaining.cal);
  const overTarget = dayRemaining < 0;
  const comment = String(exerciseLog.commentTh ?? "").trim();

  const bodyContents: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: activityName,
      weight: "bold",
      size: "md",
      color: FLEX_CUSTOMER.ink,
      wrap: true,
      maxLines: 2
    },
    {
      type: "box",
      layout: "baseline",
      margin: "md",
      contents: [
        { type: "text", text: `${rawCaloriesBurned}`, size: "xxl", weight: "bold", color: FLEX_CUSTOMER.ink, flex: 0 },
        { type: "text", text: "kcal ที่เบิร์น", size: "sm", color: FLEX_CUSTOMER.muted, margin: "sm", flex: 0 }
      ]
    },
    {
      type: "box",
      layout: "horizontal",
      alignItems: "center",
      backgroundColor: FLEX_CUSTOMER.tint,
      cornerRadius: "12px",
      paddingAll: "12px",
      margin: "md",
      contents: [
        {
          type: "box",
          layout: "vertical",
          flex: 1,
          contents: [
            { type: "text", text: "เพิ่มโควต้าอาหารวันนี้", size: "xs", color: FLEX_CUSTOMER.muted },
            { type: "text", text: "คิดให้ 50% จากพลังงานที่เบิร์น", size: "xs", color: FLEX_CUSTOMER.inkSoft, margin: "xs", wrap: true }
          ]
        },
        { type: "text", text: `+${caloriesBurned} kcal`, size: "md", weight: "bold", color: FLEX_CUSTOMER.greenDeep, flex: 0, align: "end" }
      ]
    },
    { type: "separator", margin: "lg" },
    { type: "text", text: "ยอดวันนี้", size: "sm", weight: "bold", color: FLEX_CUSTOMER.ink, margin: "lg" },
    {
      type: "box",
      layout: "horizontal",
      margin: "sm",
      contents: [
        { type: "text", text: "กินแล้ว", size: "sm", color: FLEX_CUSTOMER.muted, flex: 1 },
        { type: "text", text: `${dayConsumed} / ${dayTarget} kcal`, size: "sm", weight: "bold", color: FLEX_CUSTOMER.ink, align: "end" }
      ]
    },
    flexProgressBar(dayTarget ? (dayConsumed / dayTarget) * 100 : 0, overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.green),
    {
      type: "text",
      text: overTarget ? `เกินเป้าวันนี้ ${Math.abs(dayRemaining)} kcal` : `ยังกินได้อีก ${dayRemaining} kcal`,
      size: "sm",
      weight: "bold",
      color: overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.greenDeep,
      margin: "sm",
      wrap: true
    }
  ];

  if (comment) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      backgroundColor: FLEX_CUSTOMER.track,
      cornerRadius: "12px",
      paddingAll: "12px",
      margin: "lg",
      contents: [
        { type: "text", text: "จากโค้ช", size: "xs", color: FLEX_CUSTOMER.muted },
        { type: "text", text: comment, size: "sm", color: FLEX_CUSTOMER.ink, margin: "sm", wrap: true }
      ]
    });
  }

  return {
    type: "flex",
    altText: `บันทึก ${activityName} แล้ว · เบิร์น ${rawCaloriesBurned} kcal · เพิ่มโควต้า ${caloriesBurned} kcal`,
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.greenDeep,
        paddingAll: "20px",
        contents: [
          { type: "text", text: "บันทึกการออกกำลังกายแล้ว", weight: "bold", size: "lg", color: FLEX_CUSTOMER.surface }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.surface,
        paddingAll: "16px",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: FLEX_CUSTOMER.green,
            height: "sm",
            action: { type: "uri", label: "เปิดแดชบอร์ด", uri: dashboardUrl }
          },
          {
            type: "button",
            style: "secondary",
            color: FLEX_CUSTOMER.danger,
            height: "sm",
            action: deleteUrl
              ? { type: "uri", label: "ลบกิจกรรมนี้", uri: deleteUrl }
              : { type: "message", label: "ลบกิจกรรมล่าสุด", text: "ลบออกกำลังกาย" }
          }
        ]
      }
    }
  };
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

async function replyWithOnboarding(replyToken: string, lineUserId: string, displayName?: string): Promise<void> {
  // Message-triggered onboarding (image/text/file before profile setup) doesn't
  // pass a name, so fetch the real LINE display name instead of showing "Member".
  const name = displayName ?? (await getLineProfile(lineUserId)).displayName;
  await replyToLineMessages(replyToken, await buildOnboardingMessages(lineUserId, name));
}

async function buildOnboardingMessages(lineUserId: string, displayName = "Member"): Promise<LineMessage[]> {
  const appConfig = await getAppRuntimeConfig();
  const liffUrl = `${appConfig.liffSettingsUrl}&uid=${encodeURIComponent(lineUserId)}`;
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
            text: "หลังตั้งค่า ระบบจะเปิดทดลองใช้งาน 3 วันให้อัตโนมัติ",
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
            color: "#146E33",
            action: { type: "uri", label: "เปิดฟอร์มตั้งค่า", uri: liffUrl }
          },
          {
            type: "button",
            style: "secondary",
            action: { type: "message", label: "ใช้ตัวอย่างตั้งค่า", text: "ตั้งค่า 2000 40-30-30" }
          },
          {
            type: "text",
            text: "แก้เป้าหมายภายหลังได้ทุกเมื่อจากเมนู \"ตั้งค่าเป้าหมาย\"",
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

function buildDashboardLinkMessage(dashboardUrl: string): LineMessage {
  return {
    type: "flex",
    altText: "เปิดแดชบอร์ด MyDietitian",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: [
          { type: "text", text: "Dashboard", weight: "bold", size: "lg", color: FLEX_CUSTOMER.ink },
          { type: "text", text: "ดูพลังงาน สารอาหาร และแนวโน้มของคุณ", size: "sm", color: FLEX_CUSTOMER.muted, wrap: true }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [{
          type: "button",
          style: "primary",
          color: FLEX_CUSTOMER.green,
          height: "sm",
          action: { type: "uri", label: "เปิดแดชบอร์ด", uri: dashboardUrl }
        }]
      }
    }
  };
}

function formatHelpReply(): string {
  return [
    "คู่มือใช้งานแบบย่อ",
    "บันทึกอาหาร: พิมพ์ชื่ออาหาร หรือส่งรูป",
    "แก้/หักของเหลือ/ลบอาหาร: ใช้ปุ่มใต้การ์ดมื้ออาหารเพื่อจัดการเฉพาะมื้อนั้น",
    "ลบกิจกรรม: ใช้ปุ่มใต้การ์ดออกกำลังกาย หรือพิมพ์ `ลบออกกำลังกาย`",
    "สรุปวันนี้: พิมพ์ `สรุป` หรือ `ยอด`",
    "จดน้ำหนัก: `หนัก 65 fat 20 muscle 28`",
    "โค้ช AI: พิมพ์ `กินอะไรดี` หรือถามเรื่องอาหารได้เลย",
    "Dashboard: พิมพ์ `กราฟ` หรือ `dashboard` (ลิงก์มีอายุ 1 ชั่วโมง)",
    "ตั้งเป้าหมาย/CUT/Bulk: พิมพ์ `ตั้งค่า`",
    "ติดต่อทีมงาน: `แอดมิน <ข้อความ>` และใช้ปุ่ม “ตอบแอดมิน” เมื่อได้รับคำตอบ"
  ].join("\n");
}

function buildSupportReplyMessage(ticketId: string, message: string): LineMessage {
  return {
    type: "flex",
    altText: "ทีมงาน MyDietitian ตอบกลับเคสของคุณ",
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.greenDeep,
        paddingAll: "20px",
        spacing: "sm",
        contents: [
          { type: "text", text: "MYDIETITIAN SUPPORT", size: "xxs", weight: "bold", color: FLEX_CUSTOMER.headerSub },
          { type: "text", text: "ข้อความจากทีมงาน", size: "xl", weight: "bold", color: FLEX_CUSTOMER.surface },
          { type: "text", text: `เคส ${ticketId.slice(0, 8)}`, size: "xs", color: FLEX_CUSTOMER.headerSub }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "20px",
        spacing: "md",
        contents: [
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#F4F8F5",
            cornerRadius: "14px",
            paddingAll: "16px",
            contents: [
              { type: "text", text: message, wrap: true, size: "sm", color: FLEX_CUSTOMER.ink }
            ]
          },
          {
            type: "text",
            text: "หากต้องการตอบกลับ แตะปุ่มด้านล่าง แล้วส่งข้อความถัดไป 1 ข้อความ",
            wrap: true,
            size: "xs",
            color: FLEX_CUSTOMER.muted
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "16px",
        paddingTop: "0px",
        contents: [{
          type: "button",
          style: "primary",
          color: FLEX_CUSTOMER.green,
          height: "sm",
          action: { type: "message", label: "ตอบแอดมิน", text: `ตอบแอดมิน ${ticketId}` }
        }]
      }
    }
  };
}

function buildSettingsLinkMessage(settingsUrl: string): LineMessage {
  return {
    type: "flex",
    altText: "ตั้งค่าเป้าหมายและโปรแกรมรายสัปดาห์",
    contents: {
      type: "bubble",
      size: "kilo",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: "⚙️ ตั้งค่าเป้าหมาย", weight: "bold", size: "lg", color: "#146E33" },
          {
            type: "text",
            text: "ตั้งเป้าหมายแคลอรี่/สารอาหาร และโปรแกรม CUT/Bulk รายสัปดาห์ได้ที่นี่ครับ",
            wrap: true,
            size: "sm",
            color: "#647067"
          }
        ]
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#146E33",
            height: "sm",
            action: { type: "uri", label: "เปิดหน้าตั้งค่า", uri: settingsUrl }
          }
        ]
      }
    }
  };
}

function buildHelpFlexMessage(liffUrl: string, dashboardUrl: string): LineMessage {
  const msgBtn = (label: string, text: string) => ({
    type: "button",
    style: "secondary",
    height: "sm",
    action: { type: "message", label, text }
  });
  const uriBtn = (label: string, uri: string, color?: string) => ({
    type: "button",
    style: color ? "primary" : "secondary",
    ...(color ? { color } : {}),
    height: "sm",
    action: { type: "uri", label, uri }
  });

  const guideRow = (
    iconName: string,
    title: string,
    detail: string
  ): Record<string, unknown> => ({
    type: "box",
    layout: "horizontal",
    spacing: "md",
    paddingAll: "12px",
    backgroundColor: FLEX_CUSTOMER.tint,
    cornerRadius: "12px",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: "36px",
        height: "36px",
        backgroundColor: FLEX_CUSTOMER.green,
        cornerRadius: "18px",
        justifyContent: "center",
        alignItems: "center",
        contents: [{ type: "image", url: `${ICON_BASE}/${iconName}.png`, size: "20px", aspectMode: "fit" }]
      },
      {
        type: "box",
        layout: "vertical",
        flex: 1,
        spacing: "xs",
        contents: [
          { type: "text", text: title, weight: "bold", size: "sm", color: FLEX_CUSTOMER.ink },
          { type: "text", text: detail, wrap: true, size: "xs", color: FLEX_CUSTOMER.inkSoft }
        ]
      }
    ]
  });

  const card = (
    position: string,
    title: string,
    subtitle: string,
    rows: Array<Record<string, unknown>>,
    buttons?: Array<Record<string, unknown>>
  ) => {
    const bubble: Record<string, unknown> = {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.surface,
        paddingAll: "20px",
        paddingBottom: "0px",
        spacing: "sm",
        contents: [
          {
            type: "box",
            layout: "horizontal",
            alignItems: "center",
            contents: [
              {
                type: "box",
                layout: "vertical",
                flex: 0,
                backgroundColor: FLEX_CUSTOMER.chipGreen,
                cornerRadius: "10px",
                paddingStart: "9px",
                paddingEnd: "9px",
                paddingTop: "3px",
                paddingBottom: "3px",
                contents: [{ type: "text", text: "คู่มือ", weight: "bold", size: "xxs", color: FLEX_CUSTOMER.greenDeep }]
              },
              { type: "filler" },
              { type: "text", text: position, size: "xs", color: FLEX_CUSTOMER.inkSoft, align: "end", flex: 0 }
            ]
          },
          { type: "text", text: title, weight: "bold", color: FLEX_CUSTOMER.greenDeep, size: "xl", wrap: true },
          { type: "text", text: subtitle, color: FLEX_CUSTOMER.inkSoft, size: "xs", wrap: true },
          { type: "box", layout: "vertical", height: "2px", backgroundColor: FLEX_CUSTOMER.green, contents: [{ type: "filler" }] }
        ]
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        contents: rows
      }
    };
    if (buttons && buttons.length) {
      bubble.footer = {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "16px",
        paddingTop: "0px",
        contents: buttons
      };
    }
    return bubble;
  };

  return {
    type: "flex",
    altText: "📖 คู่มือการใช้งาน MyDietitian",
    contents: {
      type: "carousel",
      contents: [
        card("1 / 4", "บันทึกมื้อให้แม่น", "ส่งรูปหรือข้อความ แล้วจัดการมื้อนั้นจากการ์ดได้เลย", [
          guideRow("camera", "บันทึกอาหาร", "ส่งรูป หรือพิมพ์ชื่ออาหาร เช่น “ข้าวมันไก่”"),
          guideRow("edit", "บันทึกย้อนหลัง", "พิมพ์ “เมื่อวาน กิน…” หรือกดปุ่มด้านล่าง แล้วส่งเมนูหรือรูป"),
          guideRow("check", "จัดการเฉพาะมื้อ", "แก้ผล หักของเหลือ หรือลบจากปุ่มใต้การ์ด")
        ], [
          uriBtn("ถ่ายรูปอาหาร", "https://line.me/R/nv/camera/", FLEX_CUSTOMER.green),
          msgBtn("บันทึกย้อนหลัง", "บันทึกย้อนหลัง")
        ]),
        card("2 / 4", "ร่างกายและกิจกรรม", "เก็บข้อมูลที่ช่วยให้เป้าหมายรายวันแม่นขึ้น", [
          guideRow("dumbbell", "บันทึกกิจกรรม", "เช่น “วิ่ง 30 นาที” ระบบจะปรับโควต้า และลบได้จากการ์ด"),
          guideRow("scale", "ติดตามน้ำหนัก", "เช่น “หนัก 65 fat 20 muscle 28”"),
          guideRow("report", "วิเคราะห์ BIA", "ส่งรายงาน InBody/BIA เป็นรูปหรือ PDF")
        ], [
          msgBtn("ดูวิธีบันทึกกิจกรรม", "ออกกำลังกาย")
        ]),
        card("3 / 4", "ติดตามความคืบหน้า", "ดูวันนี้ ภาพรวม และปรับแผนให้เข้ากับเป้าหมาย", [
          guideRow("summary", "สรุปวันนี้", "ดูสารอาหาร มื้อที่บันทึก และคำแนะนำถัดไป"),
          guideRow("trend", "Dashboard ส่วนตัว", "ดูกราฟและประวัติผ่านลิงก์อายุ 1 ชั่วโมง"),
          guideRow("target", "เป้าหมาย / CUT / Bulk", "ตั้งเป้าหมายหรือให้ระบบปรับแผนรายสัปดาห์")
        ], [
          uriBtn("เปิด Dashboard", dashboardUrl, FLEX_CUSTOMER.green),
          msgBtn("สรุปวันนี้", "สรุป"),
          uriBtn("ตั้งค่าเป้าหมาย", liffUrl)
        ]),
        card("4 / 4", "โค้ชและความช่วยเหลือ", "รับคำแนะนำ ดูสิทธิ์ และคุยกับทีมงานได้ใน LINE", [
          guideRow("bowl", "โค้ช AI", "พิมพ์ “กินอะไรดี” เพื่อรับเมนูตามยอดวันนี้"),
          guideRow("ticket", "บัญชีและวันใช้งาน", "พิมพ์ “เช็คสถานะ” หรือ “เติมวัน”"),
          guideRow("chat", "ติดต่อทีมงาน", "พิมพ์ “แอดมิน <ข้อความ>” แล้วตอบผ่านปุ่มที่ได้รับ")
        ], [
          msgBtn("ให้ AI แนะนำเมนู", "กินอะไรดี"),
          msgBtn("ติดต่อทีมงาน", "แอดมิน")
        ])
      ]
    }
  };
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

function isLifetimeSubscription(data: FirebaseFirestore.DocumentData): boolean {
  return Boolean(data.lifetime || data.entitlementType === "lifetime");
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

function flexHealthScoreChip(score: number | string | undefined): { backgroundColor: string; color: string } {
  const value = Number(score);
  if (!Number.isFinite(value)) {
    return { backgroundColor: FLEX_CUSTOMER.track, color: FLEX_CUSTOMER.muted };
  }
  if (value >= 7) {
    return { backgroundColor: "#E7F7F0", color: FLEX_CUSTOMER.greenDeep };
  }
  if (value >= 4) {
    return { backgroundColor: FLEX_CUSTOMER.streakBg, color: FLEX_CUSTOMER.streakText };
  }
  return { backgroundColor: "#FEE9E6", color: FLEX_CUSTOMER.danger };
}

function formatMealReply(mealLog: Record<string, unknown>): string {
  const nutrients = mealLog.nutrients as Record<string, number>;
  const rating = mealLog.healthRating as Record<string, string | number>;
  const mealName = String(mealLog.mealNameTh ?? mealLog.mealNameEn ?? "มื้ออาหาร");
  const kcal = Math.round(nutrients.caloriesKcal ?? 0);
  const streak = normalizeStreak(mealLog);
  const streakLine = streak.count > 1 ? `ติดต่อกัน ${streak.count} วัน` : "วันแรกที่บันทึก";

  const lines = [
    `บันทึกแล้ว: ${mealName}`,
    `${kcal} kcal · คะแนน ${rating.score ?? "-"}/10`,
    `โปรตีน ${Math.round(nutrients.proteinG ?? 0)}g · คาร์บ ${Math.round(nutrients.carbsG ?? 0)}g · ไขมัน ${Math.round(nutrients.fatG ?? 0)}g · ไฟเบอร์ ${Number(nutrients.fiberG ?? 0).toFixed(1)}g`,
    streakLine
  ];
  const comment = String(rating.commentTh ?? "").trim();
  if (comment) lines.push(comment);
  return lines.join("\n");
}

// LINE Flex doesn't have a progress-bar component, so simulate one with a filled
// inner box whose width is a percentage of the neutral track box.
function flexProgressBar(pct: number, color: string): Record<string, unknown> {
  const width = Math.max(2, Math.min(100, Math.round(pct)));
  return {
    type: "box",
    layout: "vertical",
    height: "6px",
    backgroundColor: FLEX_CUSTOMER.track,
    cornerRadius: "3px",
    margin: "sm",
    contents: [
      {
        type: "box",
        layout: "vertical",
        width: `${width}%`,
        height: "6px",
        backgroundColor: color,
        cornerRadius: "3px",
        contents: [{ type: "filler" }]
      }
    ]
  };
}

function flexMacroRow(label: string, valueText: string, pct: number, color: string): Record<string, unknown> {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    contents: [
      {
        type: "box",
        layout: "horizontal",
        contents: [
          { type: "text", text: label, size: "sm", color: FLEX_CUSTOMER.muted, flex: 1 },
          { type: "text", text: valueText, size: "sm", weight: "bold", color: FLEX_CUSTOMER.ink, align: "end" }
        ]
      },
      flexProgressBar(pct, color)
    ]
  };
}

async function replyWithMealCard(replyToken: string, canonicalUserId: string, lineUserId: string, mealLog: Record<string, unknown>): Promise<void> {
  await replyToLineMessages(replyToken, [await buildMealCardMessage(canonicalUserId, mealLog)]);
}

async function buildMealCardMessage(canonicalUserId: string, mealLog: Record<string, unknown>): Promise<LineMessage> {
  const profile = await getUserProfile(canonicalUserId);
  const summaryDay = resolveMealCardSummaryDay(mealLog);
  const summary = await getDaySummary(canonicalUserId, profile, summaryDay);
  const appConfig = await getAppRuntimeConfig();
  const mealLogId = String(mealLog.id ?? "");
  return buildMealReplyMessage(
    mealLog,
    summary,
    await createDashboardAccessUrl(canonicalUserId),
    {
      editUrl: mealLogId ? buildLiffMealPageUrl(appConfig.liffSettingsUrl, "meal-edit", mealLogId) : "",
      leftoverUrl: mealLogId ? buildLiffMealPageUrl(appConfig.liffSettingsUrl, "leftover", mealLogId) : "",
      deleteUrl: mealLogId ? buildLiffMealPageUrl(appConfig.liffSettingsUrl, "meal-delete", mealLogId) : ""
    }
  );
}

function resolveMealCardSummaryDay(mealLog: Record<string, unknown>): Date {
  const intended = typeof mealLog.intendedDayKey === "string" ? mealLog.intendedDayKey : "";
  if (intended && /^\d{4}-\d{2}-\d{2}$/.test(intended)) {
    const [year, month, day] = intended.split("-").map(Number);
    return new Date(Date.UTC(year, month - 1, day, 5, 0, 0, 0));
  }
  if (mealLog.backdated) {
    const loggedAt = normalizeTimestamp(mealLog.loggedAt);
    if (loggedAt) return loggedAt.toDate();
  }
  return new Date();
}

async function pushRefreshedMealCard(canonicalUserId: string, lineUserId: string, mealLogId: string): Promise<boolean> {
  try {
    const meal = await getOwnedMealLog(canonicalUserId, mealLogId);
    if (!meal) return false;
    await pushMessages(lineUserId, [await buildMealCardMessage(canonicalUserId, { ...(meal.data() ?? {}), id: meal.id })]);
    return true;
  } catch (error) {
    await db.collection("adminAuditLogs").add({
      type: "meal-edit-flex-push-failed",
      canonicalUserId,
      lineUserId,
      mealLogId,
      error: error instanceof Error ? error.message : String(error),
      createdAt: Timestamp.now()
    });
    return false;
  }
}

function buildMealReplyMessage(
  mealLog: Record<string, unknown>,
  summary: TodaySummary,
  dashboardUrl: string,
  actions: { editUrl: string; leftoverUrl: string; deleteUrl: string }
): LineMessage {
  const nutrients = mealLog.nutrients as Record<string, number>;
  const rating = mealLog.healthRating as Record<string, string | number>;
  const p = Math.round(nutrients.proteinG ?? 0);
  const c = Math.round(nutrients.carbsG ?? 0);
  const f = Math.round(nutrients.fatG ?? 0);
  const fib = Number(nutrients.fiberG ?? 0);
  const kcal = Math.round(nutrients.caloriesKcal ?? 0);
  const streak = normalizeStreak(mealLog);
  const streakCount = streak.count;
  const comment = String(rating.commentTh ?? "").trim();
  const portionDescription = String(mealLog.portionDescription ?? "").trim();
  const scoreChip = flexHealthScoreChip(rating.score);
  const mealName = String(mealLog.mealNameTh ?? mealLog.mealNameEn ?? "มื้ออาหาร");
  const isBackdated = Boolean(mealLog.backdated);
  const backdateLabel = typeof mealLog.intendedDayKey === "string" && mealLog.intendedDayKey
    ? formatThaiShortDayLabel(mealLog.intendedDayKey)
    : "";

  const headerContents: Array<Record<string, unknown>> = [
    {
      type: "text",
      text: isBackdated && backdateLabel ? `บันทึกย้อนหลัง · ${backdateLabel}` : "บันทึกแล้ว",
      weight: "bold",
      size: "lg",
      color: "#FFFFFF"
    }
  ];
  if (!isBackdated && streakCount > 1) {
    headerContents.push({
      type: "box",
      layout: "horizontal",
      backgroundColor: FLEX_CUSTOMER.streakBg,
      cornerRadius: "999px",
      paddingAll: "6px",
      paddingStart: "12px",
      paddingEnd: "12px",
      margin: "md",
      contents: [
        {
          type: "text",
          text: `ติดต่อกัน ${streakCount} วันแล้ว`,
          size: "xs",
          weight: "bold",
          color: FLEX_CUSTOMER.streakText,
          align: "center"
        }
      ]
    });
  }

  const bodyContents: Array<Record<string, unknown>> = [
    {
      type: "box",
      layout: "horizontal",
      alignItems: "center",
      spacing: "sm",
      contents: [
        { type: "text", text: mealName, weight: "bold", size: "md", color: FLEX_CUSTOMER.ink, flex: 1, wrap: true, maxLines: 2 },
        {
          type: "box",
          layout: "vertical",
          flex: 0,
          backgroundColor: scoreChip.backgroundColor,
          cornerRadius: "999px",
          paddingAll: "4px",
          paddingStart: "10px",
          paddingEnd: "10px",
          contents: [{ type: "text", text: `${rating.score ?? "-"}/10`, size: "sm", weight: "bold", color: scoreChip.color, align: "center" }]
        }
      ]
    },
    {
      type: "box",
      layout: "baseline",
      margin: "md",
      contents: [
        { type: "text", text: `${kcal}`, size: "xxl", weight: "bold", color: FLEX_CUSTOMER.ink, flex: 0 },
        { type: "text", text: "kcal", size: "sm", color: FLEX_CUSTOMER.muted, margin: "sm", flex: 0 }
      ]
    },
    {
      type: "text",
      text: `มื้อนี้ · โปรตีน ${p}g · คาร์บ ${c}g · ไขมัน ${f}g · ไฟเบอร์ ${fib.toFixed(1)}g`,
      size: "sm",
      color: FLEX_CUSTOMER.muted,
      margin: "sm",
      wrap: true
    }
  ];

  if (portionDescription) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      backgroundColor: "#F4F9F5",
      cornerRadius: "10px",
      paddingAll: "12px",
      margin: "md",
      contents: [
        { type: "text", text: "AI ประเมิน", size: "xs", weight: "bold", color: FLEX_CUSTOMER.greenDeep, margin: "none" },
        { type: "text", text: portionDescription, size: "sm", color: FLEX_CUSTOMER.ink, margin: "sm", wrap: true }
      ]
    });
  }

  const dailyMacroRow = (label: string, consumed: number, remaining: number, color: string) => {
    const target = Math.round(consumed + remaining);
    return flexMacroRow(label, `${Math.round(consumed)} / ${target}g`, target ? (consumed / target) * 100 : 0, color);
  };

  const dayTarget = Math.round(summary.dynamicTarget);
  const dayConsumed = Math.round(summary.consumed.cal);
  const dayRemaining = Math.round(summary.remaining.cal);
  const overTarget = dayConsumed > dayTarget;
  const encouragementText = dailySummaryEncouragementText(
    dayTarget,
    dayConsumed,
    dayRemaining,
    overTarget,
    isBackdated ? 0 : streakCount
  );

  bodyContents.push(
    { type: "separator", margin: "lg" },
    {
      type: "text",
      text: isBackdated && backdateLabel ? `ยอด ${backdateLabel}` : "ยอดวันนี้",
      size: "sm",
      weight: "bold",
      color: FLEX_CUSTOMER.ink,
      margin: "none"
    },
    {
      type: "box",
      layout: "horizontal",
      margin: "sm",
      contents: [
        { type: "text", text: "แคลอรี่", size: "sm", color: FLEX_CUSTOMER.muted, flex: 1 },
        { type: "text", text: `${dayConsumed} / ${dayTarget} kcal`, size: "sm", weight: "bold", color: FLEX_CUSTOMER.ink, align: "end" }
      ]
    },
    flexProgressBar(dayTarget ? (dayConsumed / dayTarget) * 100 : 0, overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.green),
    {
      type: "text",
      text: encouragementText,
      size: "sm",
      weight: "bold",
      color: overTarget ? FLEX_CUSTOMER.danger : FLEX_CUSTOMER.greenDeep,
      margin: "sm",
      wrap: true
    },
    dailyMacroRow("โปรตีน", summary.consumed.p, summary.remaining.p, FLEX_CUSTOMER.protein),
    dailyMacroRow("คาร์บ", summary.consumed.c, summary.remaining.c, FLEX_CUSTOMER.carb),
    dailyMacroRow("ไขมัน", summary.consumed.f, summary.remaining.f, FLEX_CUSTOMER.fat),
    dailyMacroRow("ไฟเบอร์", summary.consumed.fib, summary.remaining.fib, FLEX_CUSTOMER.fiber)
  );

  if (comment) {
    bodyContents.push({
      type: "box",
      layout: "vertical",
      backgroundColor: FLEX_CUSTOMER.track,
      cornerRadius: "10px",
      paddingAll: "12px",
      margin: "lg",
      contents: [
        { type: "text", text: "จากโค้ช", size: "xs", color: FLEX_CUSTOMER.muted, margin: "none" },
        { type: "text", text: comment, size: "sm", color: FLEX_CUSTOMER.ink, wrap: true, margin: "sm" }
      ]
    });
  } else if (!isBackdated && streakCount <= 1) {
    bodyContents.push({
      type: "text",
      text: "วันแรกที่บันทึก — ไปต่อกันนะ",
      size: "sm",
      color: FLEX_CUSTOMER.greenDeep,
      margin: "lg",
      wrap: true
    });
  }

  return {
    type: "flex",
    altText: formatMealReply(mealLog).slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.green,
        paddingAll: "16px",
        contents: headerContents
      },
      body: {
        type: "box",
        layout: "vertical",
        backgroundColor: FLEX_CUSTOMER.surface,
        paddingAll: "16px",
        contents: bodyContents
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: FLEX_CUSTOMER.green,
            height: "sm",
            action: { type: "uri", label: "เปิดแดชบอร์ด", uri: dashboardUrl }
          },
          {
            type: "box",
            layout: "horizontal",
            spacing: "sm",
            contents: [
              {
                type: "button",
                style: "secondary",
                height: "sm",
                flex: 1,
                action: actions.editUrl
                  ? { type: "uri", label: "แก้ผลประเมิน", uri: actions.editUrl }
                  : { type: "message", label: "แก้ผลประเมิน", text: "แก้เป็น " }
              },
              {
                type: "button",
                style: "secondary",
                height: "sm",
                flex: 1,
                action: actions.leftoverUrl
                  ? { type: "uri", label: "หักของเหลือ", uri: actions.leftoverUrl }
                  : { type: "message", label: "หักของเหลือ", text: "หักของเหลือ" }
              }
            ]
          },
          {
            type: "button",
            style: "primary",
            color: FLEX_CUSTOMER.danger,
            height: "sm",
            action: actions.deleteUrl
              ? { type: "uri", label: "ลบมื้อนี้", uri: actions.deleteUrl }
              : { type: "message", label: "ลบมื้อนี้", text: "ลบ" }
          }
        ]
      }
    }
  };
}

function buildBiaReplyMessage(
  biaReportId: string,
  profile: UserProfile,
  analysis: Awaited<ReturnType<typeof analyzeBiaReport>>
): LineMessage {
  const metrics = analysis.metrics ?? {};
  const rec = analysis.recommendation ?? {};
  const newTdee = Math.round(Number(rec.suggested_tdee ?? profile.target.cal));
  const np = Math.round(Number(rec.suggested_p ?? profile.target.p));
  const nc = Math.round(Number(rec.suggested_c ?? profile.target.c));
  const nf = Math.round(Number(rec.suggested_f ?? profile.target.f));
  const oldTdee = Math.round(profile.target.cal);
  const reason = String(rec.reason_th ?? "");

  const metricRow = (label: string, value: string): Record<string, unknown> => ({
    type: "box",
    layout: "horizontal",
    margin: "sm",
    contents: [
      { type: "text", text: label, size: "sm", color: "#6B7280", flex: 1 },
      { type: "text", text: value, size: "sm", weight: "bold", color: "#374151", align: "end" }
    ]
  });

  const bodyContents: Array<Record<string, unknown>> = [
    { type: "text", text: "ผลวิเคราะห์ BIA / สุขภาพ", weight: "bold", size: "md", color: "#111827" },
    metricRow("น้ำหนัก", `${formatOptionalNumber(metrics.weight_kg)} kg`),
    metricRow("ไขมัน", `${formatOptionalNumber(metrics.fat_pct)} %`),
    metricRow("กล้ามเนื้อ", `${formatOptionalNumber(metrics.muscle_kg)} kg`),
    metricRow("BMR", `${formatOptionalNumber(metrics.bmr)} kcal`),
    metricRow("Visceral", `${formatOptionalNumber(metrics.visceral_lvl)}`),
    { type: "separator", margin: "lg" },
    { type: "text", text: String(rec.goal_name ?? "ปรับเป้าหมาย"), weight: "bold", size: "sm", color: "#185FA5", margin: "lg", wrap: true },
    {
      type: "box",
      layout: "vertical",
      backgroundColor: "#E1F5EE",
      cornerRadius: "8px",
      paddingAll: "12px",
      margin: "md",
      contents: [
        { type: "text", text: "เป้าหมายใหม่ที่แนะนำ", size: "xs", color: "#0F6E56" },
        {
          type: "box",
          layout: "baseline",
          margin: "sm",
          contents: [
            { type: "text", text: `${oldTdee}`, size: "sm", color: "#9CA3AF", decoration: "line-through", flex: 0 },
            { type: "text", text: "→", size: "sm", color: "#0F6E56", margin: "sm", flex: 0 },
            { type: "text", text: `${newTdee} kcal`, size: "lg", weight: "bold", color: "#0F6E56", margin: "sm", flex: 0 }
          ]
        },
        { type: "text", text: `P ${np}g · C ${nc}g · F ${nf}g`, size: "xs", color: "#0F6E56", margin: "sm" }
      ]
    }
  ];

  if (reason) {
    bodyContents.push({ type: "text", text: reason, size: "xs", color: "#4B5563", wrap: true, margin: "md" });
  }

  return {
    type: "flex",
    altText: formatBiaAnalysisReply(biaReportId, profile, analysis).slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      body: { type: "box", layout: "vertical", backgroundColor: "#FFFFFF", paddingAll: "16px", contents: bodyContents },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingAll: "12px",
        contents: [
          {
            type: "button",
            style: "primary",
            color: "#1D9E75",
            height: "sm",
            action: { type: "message", label: `ใช้เป้าใหม่ ${newTdee}`, text: `CONFIRM_UPDATE_TARGET ${newTdee} ${np}-${nc}-${nf}` }
          },
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "message", label: "ไม่ปรับเป้าหมาย", text: "ไม่ปรับเป้าหมาย" }
          }
        ]
      }
    }
  };
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
  if (request.option === "custom" && request.customStartStr && request.customEndStr) {
    const startDate = new Date(request.customStartStr);
    const endDate = new Date(request.customEndStr);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    return { startDate, endDate };
  }
  // Anchor on the Bangkok day so "today" stays correct during 00:00-07:00 ICT,
  // when the server's UTC clock is still on the previous day.
  const days = typeof request.option === "number" ? request.option : 7;
  const dayMs = 24 * 60 * 60 * 1000;
  // offsetDays shifts the window backward so the trend view can page through
  // older periods.
  const offset = Math.max(0, Math.floor(Number(request.offsetDays) || 0));
  const today = getBangkokDayRange(new Date());
  const endDate = new Date(today.endDate.getTime() - offset * dayMs);
  const startDate = new Date(today.startDate.getTime() - (offset + days - 1) * dayMs);
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

// Minimum grams we never cut below, so a long CUT can't drive a macro to zero.
// Fat has a hormonal-health floor; carbs/protein floors keep the diet sane.
const PROGRAM_MACRO_FLOOR_G: Record<ProgramMacro, number> = {
  protein: 40,
  carbs: 20,
  fat: 20
};
const PROGRAM_MIN_CALORIES = 1000;
const PROGRAM_MACRO_LABEL_TH: Record<ProgramMacro, string> = {
  carbs: "คาร์บ",
  fat: "ไขมัน",
  protein: "โปรตีน"
};

type ProgramBaseline = WeeklyProgram["baseline"];

// Returns the active program map or null. A program is only in effect when its
// type is valid and status is "active"; a completed/paused program is ignored
// so the plain saved target applies.
function normalizeProgram(profile: Record<string, unknown>): WeeklyProgram | null {
  const raw = profile.program;
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Record<string, unknown>;
  const type = p.type === "bulk" ? "bulk" : p.type === "cut" ? "cut" : null;
  const status = typeof p.status === "string" ? p.status : "active";
  if (!type || status !== "active") return null;

  const weeks = Math.round(Number(p.weeks));
  const stepKcalPerWeek = Math.abs(Number(p.stepKcalPerWeek));
  const startDate = String(p.startDate ?? "");
  const adjustMacro: ProgramMacro =
    p.adjustMacro === "fat" || p.adjustMacro === "protein" ? p.adjustMacro : "carbs";
  const immediateStart = p.immediateStart !== false; // default: cut starts in week 1
  const baselineRaw = (p.baseline ?? {}) as Record<string, unknown>;
  const baseline: ProgramBaseline = {
    calories: Number(baselineRaw.calories ?? 0),
    proteinG: Number(baselineRaw.proteinG ?? 0),
    carbsG: Number(baselineRaw.carbsG ?? 0),
    fatG: Number(baselineRaw.fatG ?? 0),
    fiberG: Number(baselineRaw.fiberG ?? 25)
  };

  if (
    !Number.isFinite(weeks) || weeks < 1 || weeks > 52 ||
    !Number.isFinite(stepKcalPerWeek) || stepKcalPerWeek <= 0 ||
    !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
    baseline.calories <= 0
  ) {
    return null;
  }

  return { type, startDate, weeks, stepKcalPerWeek, adjustMacro, immediateStart, baseline, status: "active" };
}

// Bangkok calendar day as "YYYY-MM-DD" (en-CA yields that format directly).
function bangkokDateString(date: Date): string {
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

// Whole-day difference between two "YYYY-MM-DD" strings, computed at UTC midnight
// to sidestep timezone/DST drift (both inputs are already Bangkok calendar days).
function daysBetweenDateStrings(fromYmd: string, toYmd: string): number {
  const from = fromYmd.split("-").map(Number);
  const to = toYmd.split("-").map(Number);
  if (from.length !== 3 || to.length !== 3 || [...from, ...to].some((value) => !Number.isFinite(value))) {
    return 0;
  }
  const fromMs = Date.UTC(from[0], from[1] - 1, from[2]);
  const toMs = Date.UTC(to[0], to[1] - 1, to[2]);
  return Math.round((toMs - fromMs) / 86400000);
}

// 0-based week the program is currently in, clamped to [0, weeks-1]. Before the
// start date the program holds at week 0 (baseline); after the last week it
// holds at the final week's target rather than continuing to cut/bulk forever.
function resolveProgramWeekIndex(program: WeeklyProgram, now: Date): number {
  const diffDays = daysBetweenDateStrings(program.startDate, bangkokDateString(now));
  if (diffDays < 0) return 0;
  return Math.min(Math.floor(diffDays / 7), program.weeks - 1);
}

// Applies `weekIndex` steps of the program to the baseline. The kcal delta is
// absorbed entirely by the chosen macro (protein/fat kept per the trainer's
// instruction), clamped at its floor; calories move by the *actual* clamped
// delta so week 1 always equals the baseline exactly.
function applyProgramWeek(baseline: ProgramBaseline, program: WeeklyProgram, weekIndex: number) {
  const sign = program.type === "cut" ? -1 : 1;
  // immediateStart shifts the ramp so week 1 already carries one step of change.
  const steps = weekIndex + (program.immediateStart ? 1 : 0);
  const targetDeltaKcal = sign * program.stepKcalPerWeek * steps;
  const kcalPerG = program.adjustMacro === "fat" ? 9 : 4;
  const floor = PROGRAM_MACRO_FLOOR_G[program.adjustMacro];
  const macroBaseG =
    program.adjustMacro === "fat" ? baseline.fatG :
    program.adjustMacro === "protein" ? baseline.proteinG :
    baseline.carbsG;
  const clampedG = Math.max(floor, Math.round(macroBaseG + targetDeltaKcal / kcalPerG));
  const actualDeltaKcal = (clampedG - macroBaseG) * kcalPerG;

  const result = {
    calories: Math.max(PROGRAM_MIN_CALORIES, Math.round(baseline.calories + actualDeltaKcal)),
    proteinG: baseline.proteinG,
    carbsG: baseline.carbsG,
    fatG: baseline.fatG,
    fiberG: baseline.fiberG
  };
  if (program.adjustMacro === "fat") result.fatG = clampedG;
  else if (program.adjustMacro === "protein") result.proteinG = clampedG;
  else result.carbsG = clampedG;
  return result;
}

// The daily target every consumer should use: the plain saved target when there
// is no active program, otherwise the current program week applied on top of the
// week-1 baseline. Same {cal,p,c,f,fib} shape as normalizeTarget, plus `program`
// metadata (week N of M) for the UI.
function resolveEffectiveTarget(profile: Record<string, unknown>, now: Date = new Date()) {
  const base = normalizeTarget(profile);
  const program = normalizeProgram(profile);
  if (!program) {
    return { cal: base.cal, p: base.p, c: base.c, f: base.f, fib: base.fib, program: null };
  }

  const baseline: ProgramBaseline = {
    calories: program.baseline.calories || base.cal,
    proteinG: program.baseline.proteinG || base.p,
    carbsG: program.baseline.carbsG || base.c,
    fatG: program.baseline.fatG || base.f,
    fiberG: program.baseline.fiberG || base.fib
  };
  const weekIndex = resolveProgramWeekIndex(program, now);
  const wk = applyProgramWeek(baseline, program, weekIndex);
  return {
    cal: wk.calories,
    p: wk.proteinG,
    c: wk.carbsG,
    f: wk.fatG,
    fib: wk.fiberG,
    program: {
      type: program.type,
      week: weekIndex + 1,
      weeks: program.weeks,
      startDate: program.startDate,
      adjustMacro: program.adjustMacro,
      stepKcalPerWeek: program.stepKcalPerWeek,
      immediateStart: program.immediateStart,
      status: program.status,
      baseline
    }
  };
}

// Full week-by-week schedule (for the settings preview table and the audit
// event), so the user sees exactly where each week lands before saving.
function buildProgramScheduleRows(baseline: ProgramBaseline, program: WeeklyProgram) {
  const rows: Array<{ week: number; calories: number; proteinG: number; carbsG: number; fatG: number }> = [];
  for (let index = 0; index < program.weeks; index += 1) {
    const wk = applyProgramWeek(baseline, program, index);
    rows.push({ week: index + 1, calories: wk.calories, proteinG: wk.proteinG, carbsG: wk.carbsG, fatG: wk.fatG });
  }
  return rows;
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
  // Bucket dashboard days by the Bangkok calendar day, not the server's UTC day,
  // so the range/labels match meal logging (which keys by Asia/Bangkok). Without
  // this, 00:00-07:00 Bangkok counts toward the previous UTC day.
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    day: "2-digit",
    month: "2-digit"
  }).formatToParts(date);
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  return `${day}/${month}`;
}
