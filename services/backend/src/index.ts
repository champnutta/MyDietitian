import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2/options";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import type {
  AnalyzeMealRequest,
  LineWebhookEvent,
  UpdateProfileRequest
} from "./contracts.js";

initializeApp();
setGlobalOptions({ region: "asia-southeast1" });
const db = getFirestore();

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

export const analyzeMeal = onRequest(async (request, response) => {
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
  const ref = db.collection("aiRuns").doc();

  await ref.set({
    runId: ref.id,
    userId: body.userId,
    source: body.source,
    inputType: body.inputType,
    text: body.text ?? null,
    imageUrl: body.imageUrl ?? null,
    status: "queued",
    createdAt: now,
    promptVersion: "meal-v1"
  });

  response.status(202).json({
    ok: true,
    runId: ref.id,
    status: "queued",
    note: "Gemini integration will replace this queue stub in the next migration pass."
  });
});

export const lineWebhook = onRequest(async (request, response) => {
  if (request.method !== "POST") {
    response.status(405).json({ ok: false, error: "method-not-allowed" });
    return;
  }

  const payload = request.body as LineWebhookEvent;
  const now = Timestamp.now();

  await db.collection("adminAuditLogs").add({
    type: "line-webhook-received",
    eventCount: payload?.events?.length ?? 0,
    payload,
    createdAt: now
  });

  response.json({
    ok: true,
    received: payload?.events?.length ?? 0
  });
});
