import { Timestamp } from "firebase-admin/firestore";
import type { SourceChannel } from "./contracts.js";
import { db } from "./runtime.js";

export async function resolveCanonicalUserId(request: {
  userId?: string;
  canonicalUserId?: string;
  source?: SourceChannel;
}): Promise<string> {
  if (request.canonicalUserId) return request.canonicalUserId;
  if (!request.userId) throw new Error("Missing user id");

  if (request.source === "line") {
    return resolveLineCanonicalUserId(request.userId);
  }

  const authLink = await db.collection("authLinks").doc(request.userId).get();
  if (authLink.exists) {
    return String(authLink.data()?.canonicalUserId ?? request.userId);
  }

  return request.userId;
}

export async function resolveLineCanonicalUserId(lineUserId: string): Promise<string> {
  const linkRef = db.collection("lineLinks").doc(lineUserId);
  const link = await linkRef.get();

  if (link.exists) {
    return String(link.data()?.canonicalUserId ?? lineUserId);
  }

  const now = Timestamp.now();
  const canonicalUserId = lineUserId;
  await linkRef.set({
    lineUserId,
    canonicalUserId,
    status: "legacy-line-primary",
    createdAt: now,
    updatedAt: now
  }, { merge: true });

  await db.collection("users").doc(canonicalUserId).set({
    userId: canonicalUserId,
    canonicalUserId,
    status: "active",
    source: { line: true, app: false },
    createdAt: now,
    updatedAt: now
  }, { merge: true });

  return canonicalUserId;
}
