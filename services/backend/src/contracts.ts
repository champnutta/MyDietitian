export type SourceChannel = "app" | "line" | "admin";
export type AiProvider = "gemini" | "anthropic" | "openai";

export interface AiAgentFallbackConfig {
  provider: AiProvider;
  model: string;
  temperature?: number;
  timeoutMs?: number;
  maxAttempts?: number;
}

export interface AiAgentConfig {
  agentId: string;
  provider: AiProvider;
  model: string;
  promptVersion: string;
  temperature: number;
  enabled: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  fallbacks?: AiAgentFallbackConfig[];
}

export interface UpdateProfileRequest {
  canonicalUserId?: string;
  displayName?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
  gender?: "male" | "female" | "other";
  age?: number;
  heightCm?: number;
  weightKg?: number;
  activityFactor?: number;
  goalType?: "fat_loss" | "recomp" | "maintain" | "muscle_gain";
  target?: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG?: number;
  };
}

export interface SaveSettingsFromWebRequest {
  userId: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
  displayName?: string;
  config: {
    mode: "auto" | "custom";
    gender?: "male" | "female" | "other" | "ชาย" | "หญิง";
    age?: number;
    height?: number;
    heightCm?: number;
    weight?: number;
    weightKg?: number;
    activity?: number;
    activityFactor?: number;
    goal?: number;
    goalType?: "fat_loss" | "recomp" | "maintain" | "muscle_gain";
    dietStyle?: "balanced" | "keto" | "lowcarb" | "highprotein" | "ai_auto";
    tdee?: number;
    p?: number;
    c?: number;
    f?: number;
    fiberG?: number;
  };
}

export type ProgramMacro = "carbs" | "fat" | "protein";

// Weekly CUT/Bulk periodization program stored on the profile. Each week the
// chosen macro (and calories) shift by a fixed kcal step, e.g. a trainer's
// "cut carbs 100 kcal/week for 8 weeks". `baseline` is the maintenance target
// (what the user eats with no cut); the effective daily target is derived from
// the current week. `immediateStart` = true applies the first step in week 1
// (cut starts now); false keeps week 1 at baseline and starts cutting in week 2.
export interface WeeklyProgram {
  type: "cut" | "bulk";
  startDate: string; // "YYYY-MM-DD" Bangkok calendar day the program begins
  weeks: number;
  stepKcalPerWeek: number; // magnitude (> 0); direction comes from `type`
  adjustMacro: ProgramMacro;
  immediateStart: boolean;
  baseline: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  status: "active" | "completed" | "paused";
}

export interface SaveWeeklyProgramRequest {
  userId: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
  type: "cut" | "bulk";
  weeks: number;
  stepKcalPerWeek: number;
  adjustMacro: ProgramMacro;
  immediateStart?: boolean; // defaults to true (cut/bulk starts in week 1)
  startDate?: string; // defaults to today (Bangkok) when omitted
}

export interface CancelWeeklyProgramRequest {
  userId: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
}

export interface LinkLineAccountRequest {
  userId?: string;
  lineUserId?: string;
  canonicalUserId?: string;
  firebaseAuthUid?: string;
}

export interface AnalyzeMealRequest {
  userId: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
  source: SourceChannel;
  inputType: "text" | "image";
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
  // The user's full free-text correction of a previous analysis (e.g. "มันคือ
  // น้ำมันมะกอกกับบัลซามิก ไม่ใช่น้ำตาล"). Passed verbatim so the prompt can
  // reconcile it against the image — fixes dish name, condiments, and macros.
  userCorrection?: string;
  // Optional Bangkok calendar day (YYYY-MM-DD) to attribute the meal to.
  // Validated server-side; future days and days older than 14 are rejected.
  // When omitted, the meal is logged as "now".
  loggedAtDayKey?: string;
}

export interface AnalyzeExerciseRequest {
  userId: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
  source: SourceChannel;
  text: string;
}

export interface CoachConsultationRequest {
  userId: string;
  source: SourceChannel;
  text: string;
  profileName: string;
  target: {
    calories: number;
    proteinG: number;
    carbsG: number;
    fatG: number;
    fiberG: number;
  };
  today: {
    consumedCalories: number;
    consumedProteinG: number;
    consumedCarbsG: number;
    consumedFatG: number;
    consumedFiberG: number;
    burnedCalories: number;
    dynamicTargetCalories: number;
    remainingCalories: number;
    remainingProteinG: number;
    remainingCarbsG: number;
    remainingFatG: number;
    remainingFiberG: number;
  };
  recentMeals: string[];
  mode: "consultation" | "menu_recommendation";
}

export interface DashboardDataRequest {
  userId?: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
  dashboardAccessToken?: string;
  option?: number | "custom";
  offsetDays?: number;
  customStartStr?: string;
  customEndStr?: string;
}

export interface LiffMealRequestIdentity {
  userId: string;
  lineUserId?: string;
  canonicalUserId?: string;
  firebaseAuthUid?: string;
}

export interface GetMealForLiffRequest extends LiffMealRequestIdentity {
  mealLogId: string;
}

export interface SaveMealEditFromLiffRequest extends GetMealForLiffRequest {
  // A portion-only update is deterministic. Any accompanying note is treated
  // as a correction and is re-analysed against the original meal context.
  portionRatio?: number;
  correctionText?: string;
}

export interface PreviewLeftoverFromLiffRequest extends GetMealForLiffRequest {
  imageBase64: string;
  mimeType: string;
}

export interface ConfirmLeftoverFromLiffRequest extends LiffMealRequestIdentity {
  previewId: string;
}

export interface DeleteMealFromLiffRequest extends GetMealForLiffRequest {}

export interface GetExerciseForLiffRequest extends LiffMealRequestIdentity {
  exerciseLogId: string;
}

export interface DeleteExerciseFromLiffRequest extends GetExerciseForLiffRequest {}

export interface MealAnalysisResult {
  analysis_status?: "ok" | "unclear_image";
  dish_name: {
    th: string;
    en: string;
  };
  portion_description: string;
  nutrients: {
    calories_kcal: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
    fiber_g?: number;
    sugar_g?: number;
  };
  health_rating: {
    score: number;
    comment: string;
  };
}

export interface ImageClassificationResult {
  type: "food" | "unclear_food" | "slip" | "bia" | "leftover" | "other";
  confidence?: number;
  slip_data?: {
    amount?: number;
    date?: string;
    time?: string;
    receiver_name?: string;
    bank_from?: string;
    bank_to?: string;
  };
}

export interface BiaAnalysisResult {
  meta: {
    date_str?: string;
    device_name?: string;
  };
  metrics: {
    weight_kg?: number;
    muscle_kg?: number;
    fat_pct?: number;
    bmr?: number;
    visceral_lvl?: number;
  };
  recommendation: {
    suggested_tdee: number;
    suggested_p: number;
    suggested_c: number;
    suggested_f: number;
    goal_name?: string;
    reason_th?: string;
  };
  workout_advice_th?: string;
}

export interface ExerciseAnalysisResult {
  activity_name: string;
  calories_burned: number;
  comment: string;
}

export interface LineWebhookEvent {
  destination?: string;
  events: Array<{
    type: string;
    replyToken?: string;
    timestamp?: number;
    source?: {
      type?: string;
      userId?: string;
    };
    message?: {
      id?: string;
      type?: string;
      text?: string;
      fileName?: string;
    };
  }>;
}
