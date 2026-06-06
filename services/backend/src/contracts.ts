export type SourceChannel = "app" | "line" | "admin";
export type AiProvider = "gemini" | "anthropic";

export interface AiAgentConfig {
  agentId: string;
  provider: AiProvider;
  model: string;
  promptVersion: string;
  temperature: number;
  enabled: boolean;
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
    };
  }>;
}
