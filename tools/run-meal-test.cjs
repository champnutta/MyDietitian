// Direct prompt tester: calls callGeminiMealAnalysis() on an image and prints
// the parsed AI result. No Firestore write, no LINE, no emulator.
//   node tools/run-meal-test.cjs <imagePath>
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || "mydietitian";
const fs = require("fs");
const { getAiAgentConfig, callGeminiMealAnalysis } = require("../services/backend/lib/ai-provider.js");

const DEFAULT_AGENT = {
  agentId: "mealAnalysis", provider: "gemini", model: "gemini-3.5-flash",
  promptVersion: "meal-v1", temperature: 0.2, enabled: true,
  timeoutMs: 30000, maxAttempts: 2,
  fallbacks: [{ provider: "anthropic", model: "claude-haiku-4-5-20251001", temperature: 0.2, timeoutMs: 30000, maxAttempts: 2 }]
};

(async () => {
  const imgPath = process.argv[2];
  if (!imgPath || !fs.existsSync(imgPath)) throw new Error("image not found: " + imgPath);
  const b64 = fs.readFileSync(imgPath).toString("base64");

  const request = { userId: "test-prompt", source: "line", inputType: "image", imageBase64: b64, mimeType: "image/jpeg" };
  const apiKeys = { gemini: process.env.GEMINI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };

  let agent;
  try {
    agent = await getAiAgentConfig("mealAnalysis");
    console.error("[agent] from Firestore:", agent.provider + "/" + agent.model, "fallbacks=", (agent.fallbacks || []).map(f => f.provider + "/" + f.model).join(","));
  } catch (e) {
    agent = DEFAULT_AGENT;
    console.error("[agent] Firestore read failed (" + e.message + ") -> using DEFAULT");
  }

  const t0 = Date.now();
  const result = await callGeminiMealAnalysis(request, apiKeys, agent);
  console.error("[done] " + (Date.now() - t0) + "ms");
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})().catch(e => { console.error("ERROR:", e && e.message ? e.message : e); process.exit(1); });
