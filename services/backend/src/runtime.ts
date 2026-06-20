import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { setGlobalOptions } from "firebase-functions/v2/options";

initializeApp();
// Co-located with Firestore (asia-southeast3 / Bangkok) to remove cross-region
// latency on the many sequential Firestore reads/writes each LINE event triggers.
setGlobalOptions({ region: "asia-southeast3" });

export const db = getFirestore();
export const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");
export const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
export const LINE_CHANNEL_SECRET = defineSecret("LINE_CHANNEL_SECRET");
export const LINE_CHANNEL_ACCESS_TOKEN = defineSecret("LINE_CHANNEL_ACCESS_TOKEN");
export const ADMIN_LINE_USER_ID = defineSecret("ADMIN_LINE_USER_ID");
