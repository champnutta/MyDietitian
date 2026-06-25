#!/usr/bin/env node
"use strict";

// One-off backfill: the Sheet->Firestore migration did not carry the GAS
// "Streak_Count" into profiles, so migrated users showed "เริ่มบันทึกวันแรก".
// This sets profile.streak = { count, lastMealLogDayKey, updatedAt } using the
// Sheet's Streak_Count and the Bangkok day-key of the user's most recent
// mealLog in Firestore (so post-cutover logs are respected and the next log
// continues/resets correctly). Dry-run by default; pass --commit to write.

const https = require("node:https");
const admin = require("firebase-admin");

const args = require("node:process").argv.slice(2);
const commit = args.includes("--commit");
const SHEET_ID = "1Yf1yxbBbV7S1nCCtxuSOC1YIdiirFbx3GKKLUv_AUPI";
const SA = "C:/Users/champ/AppData/Roaming/firebase/znak_iiz_gmail.com_application_default_credentials.json";

function bangkokDayKey(date) {
  return new Date(date.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

function fetchUsersStreaks() {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=Users&headers=1`;
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        try {
          const m = body.match(/setResponse\(([\s\S]*)\)/);
          const json = JSON.parse(m ? m[1] : body);
          const out = {};
          for (const row of json.table.rows) {
            const uid = row.c[0] && row.c[0].v ? String(row.c[0].v) : null;
            if (!uid) continue;
            out[uid] = row.c[8] && row.c[8].v != null ? Number(row.c[8].v) : 0;
          }
          resolve(out);
        } catch (e) {
          reject(e);
        }
      });
    }).on("error", reject);
  });
}

async function main() {
  process.env.GOOGLE_APPLICATION_CREDENTIALS = SA;
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: "mydietitian" });
  const db = admin.firestore();

  const streaks = await fetchUsersStreaks();

  // Most recent mealLog day-key per user.
  const lastDay = {};
  const meals = await db.collection("mealLogs").get();
  meals.forEach((d) => {
    const x = d.data();
    const uid = x.canonicalUserId || x.userId;
    const at = x.loggedAt && x.loggedAt.toDate ? x.loggedAt.toDate() : null;
    if (!uid || !at) return;
    const key = bangkokDayKey(at);
    if (!lastDay[uid] || key > lastDay[uid]) lastDay[uid] = key;
  });

  const profiles = await db.collection("profiles").get();
  let planned = 0;
  const now = admin.firestore.Timestamp.now();
  const samples = [];
  for (const doc of profiles.docs) {
    const uid = doc.id;
    const count = Math.max(0, Number(streaks[uid] ?? 0));
    const lastMealLogDayKey = lastDay[uid] || null;
    if (count <= 0 || !lastMealLogDayKey) continue; // nothing meaningful to restore
    planned += 1;
    if (samples.length < 8) samples.push(`${uid.slice(0, 8)} count=${count} last=${lastMealLogDayKey}`);
    if (commit) {
      await doc.ref.set({ streak: { count, lastMealLogDayKey, updatedAt: now }, updatedAt: now }, { merge: true });
    }
  }

  console.log(JSON.stringify({ mode: commit ? "committed" : "dry-run", profiles: profiles.size, streaksFromSheet: Object.keys(streaks).length, patched: planned, samples }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e.message || String(e)); process.exit(1); });
