#!/usr/bin/env node
"use strict";

// One-time snapshot: compute per-user firstLog / lastLog / mealCount from
// mealLogs and store them on profiles.stats so the admin "all customers" list
// can show "started using" and total meals without scanning meals on every load.
// firstLogAt is stable; lastLogAt/mealCount are a snapshot (re-run to refresh).
// Dry-run by default; pass --commit to write.

const admin = require("firebase-admin");
const SA = "C:/Users/champ/AppData/Roaming/firebase/znak_iiz_gmail.com_application_default_credentials.json";
const commit = process.argv.includes("--commit");

async function main() {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = SA;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "mydietitian" });
  const db = admin.firestore();

  const stats = {};
  const meals = await db.collection("mealLogs").get();
  meals.forEach((doc) => {
    const x = doc.data();
    const uid = x.canonicalUserId || x.userId;
    const at = x.loggedAt && x.loggedAt.toDate ? x.loggedAt.toDate().getTime() : null;
    if (!uid || !at) return;
    const s = stats[uid] ?? (stats[uid] = { first: at, last: at, count: 0 });
    if (at < s.first) s.first = at;
    if (at > s.last) s.last = at;
    s.count += 1;
  });

  // Only touch profiles that actually exist (some mealLogs carry malformed
  // userIds — e.g. timestamp strings — which must not become phantom profiles).
  const existing = new Set();
  (await db.collection("profiles").select().get()).forEach((d) => existing.add(d.id));

  const now = admin.firestore.Timestamp.now();
  let written = 0, skipped = 0;
  const sample = [];
  for (const [uid, s] of Object.entries(stats)) {
    if (!existing.has(uid)) { skipped += 1; continue; }
    if (sample.length < 5) sample.push(`${uid.slice(0, 8)} first=${new Date(s.first).toISOString().slice(0, 10)} count=${s.count}`);
    if (commit) {
      await db.collection("profiles").doc(uid).set({
        stats: {
          firstLogAt: admin.firestore.Timestamp.fromMillis(s.first),
          lastLogAt: admin.firestore.Timestamp.fromMillis(s.last),
          mealCount: s.count,
          computedAt: now
        }
      }, { merge: true });
      written += 1;
    }
  }
  console.log(JSON.stringify({ mode: commit ? "committed" : "dry-run", usersWithMeals: Object.keys(stats).length, written, skipped, sample }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || String(e)); process.exit(1); });
