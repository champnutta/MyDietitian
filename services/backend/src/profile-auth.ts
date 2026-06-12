import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import type { Request } from "firebase-functions/v2/https";
import { db } from "./runtime.js";

const DEFAULT_LINE_CHANNEL_ID = "2009365288";

type ProfileIdentityRequest = {
  userId: string;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
};

type VerifiedProfileOwner = {
  verified: boolean;
  provider: "firebase" | "line" | "none";
  subject: string | null;
  canonicalUserId?: string;
  lineUserId?: string;
  firebaseAuthUid?: string;
};

export class ProfileAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProfileAuthError";
  }
}

export async function verifyProfileOwnership(
  request: Request,
  identity: ProfileIdentityRequest
): Promise<VerifiedProfileOwner> {
  const firebaseToken = readBearerToken(request);
  if (firebaseToken) {
    return verifyFirebaseOwner(firebaseToken, identity);
  }

  const lineIdToken = readHeader(request, "x-line-id-token");
  if (lineIdToken) {
    return verifyLineOwner(lineIdToken, identity);
  }

  if (isProfileAuthRequired()) {
    throw new ProfileAuthError("missing verified identity token");
  }

  return { verified: false, provider: "none", subject: null };
}

export function isProfileAuthRequired() {
  return (process.env.PROFILE_AUTH_MODE ?? "optional").toLowerCase() === "required";
}

function readBearerToken(request: Request) {
  const header = readHeader(request, "authorization");
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1]?.trim() || null;
}

function readHeader(request: Request, name: string) {
  const value = request.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function verifyFirebaseOwner(token: string, identity: ProfileIdentityRequest): Promise<VerifiedProfileOwner> {
  const decoded = await verifyFirebaseIdToken(token);
  const firebaseAuthUid = decoded.uid;
  if (identity.firebaseAuthUid && identity.firebaseAuthUid !== firebaseAuthUid) {
    throw new ProfileAuthError("firebaseAuthUid does not match token owner");
  }

  const link = await db.collection("authLinks").doc(firebaseAuthUid).get();
  const linkedCanonicalUserId = link.exists ? String(link.data()?.canonicalUserId ?? "") : "";
  if (identity.canonicalUserId && linkedCanonicalUserId && identity.canonicalUserId !== linkedCanonicalUserId) {
    throw new ProfileAuthError("canonicalUserId does not match Firebase account link");
  }

  return {
    verified: true,
    provider: "firebase",
    subject: firebaseAuthUid,
    canonicalUserId: linkedCanonicalUserId || identity.canonicalUserId || firebaseAuthUid,
    firebaseAuthUid
  };
}

async function verifyFirebaseIdToken(token: string) {
  try {
    return await getAuth().verifyIdToken(token);
  } catch {
    throw new ProfileAuthError("Firebase token verification failed");
  }
}

async function verifyLineOwner(token: string, identity: ProfileIdentityRequest): Promise<VerifiedProfileOwner> {
  const channelId = process.env.LINE_CHANNEL_ID ?? DEFAULT_LINE_CHANNEL_ID;
  if (!channelId) {
    throw new ProfileAuthError("LINE_CHANNEL_ID is not configured");
  }

  const result = await verifyLineIdToken(token, channelId);
  const lineUserId = result.sub;
  if (!lineUserId) throw new ProfileAuthError("LINE token has no subject");
  if (identity.lineUserId && identity.lineUserId !== lineUserId) {
    throw new ProfileAuthError("lineUserId does not match token owner");
  }
  if (identity.userId.startsWith("U") && identity.userId !== lineUserId) {
    throw new ProfileAuthError("userId does not match LINE token owner");
  }

  const link = await db.collection("lineLinks").doc(lineUserId).get();
  const linkedCanonicalUserId = link.exists ? String(link.data()?.canonicalUserId ?? "") : "";
  if (identity.canonicalUserId && linkedCanonicalUserId && identity.canonicalUserId !== linkedCanonicalUserId) {
    throw new ProfileAuthError("canonicalUserId does not match LINE account link");
  }

  return {
    verified: true,
    provider: "line",
    subject: lineUserId,
    canonicalUserId: linkedCanonicalUserId || identity.canonicalUserId || lineUserId,
    lineUserId
  };
}

async function verifyLineIdToken(token: string, channelId: string): Promise<{ sub?: string }> {
  const response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: token, client_id: channelId })
  });

  if (!response.ok) {
    throw new ProfileAuthError(`LINE token verification failed with status ${response.status}`);
  }

  return await response.json() as { sub?: string };
}

export async function writeProfileAuthAudit(
  functionName: "saveSettingsFromWeb" | "updateProfile",
  canonicalUserId: string,
  owner: VerifiedProfileOwner
) {
  if (!owner.verified) return;
  await db.collection("profileAuthEvents").add({
    functionName,
    canonicalUserId,
    provider: owner.provider,
    subject: owner.subject,
    firebaseAuthUid: owner.firebaseAuthUid ?? null,
    lineUserId: owner.lineUserId ?? null,
    createdAt: Timestamp.now()
  });
}
