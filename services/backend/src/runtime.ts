import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2/options";

initializeApp();
setGlobalOptions({ region: "asia-southeast1" });

export const db = getFirestore();
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
export const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
export const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
export const ADMIN_LINE_USER_ID = defineSecret("ADMIN_LINE_USER_ID");
