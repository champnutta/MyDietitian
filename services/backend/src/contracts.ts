export type SourceChannel = "app" | "line" | "admin";

export interface UpdateProfileRequest {
  displayName?: string;
  lineUserId?: string;
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
  source: SourceChannel;
  inputType: "text" | "image";
  text?: string;
  imageUrl?: string;
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

