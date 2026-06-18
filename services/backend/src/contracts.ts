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

export interface AnalyzeMealRequest {
  userId: string;
  canonicalUserId?: string;
  source: SourceChannel;
  inputType: "text" | "image";
  text?: string;
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
}

export interface AnalyzeExerciseRequest {
  userId: string;
  canonicalUserId?: string;
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
  userId: string;
  canonicalUserId?: string;
  option?: number | "custom";
  customStartStr?: string;
  customEndStr?: string;
}

export interface MealAnalysisResult {
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
  type: "food" | "slip" | "bia" | "leftover" | "other";
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
