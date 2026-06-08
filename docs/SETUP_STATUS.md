# Setup Status

## GitHub

- Local git repo exists
- Remote configured: `https://github.com/champnutta/MyDietitian.git`
- Commits are pushed to `origin/master`

## Firebase

- Firebase CLI is installed
- Logged in account detected: `znak.iiz@gmail.com`
- Firebase project created successfully:
  - Project name: `Mydietitian`
  - Project ID: `mydietitian`
- `.firebaserc` now points to `mydietitian`
- Firestore database created:
  - Database: `(default)`
  - Edition: `STANDARD`
  - Mode: `FIRESTORE_NATIVE`
  - Location: `asia-southeast3 (Bangkok)`
- Firestore rules and indexes deployed successfully
- Functions scaffold compiles locally
- Firebase Functions cannot be deployed to `asia-southeast3` through Firebase Functions in this project.
- Functions region is set to `asia-southeast1 (Singapore)` as the closest Firebase Functions region to Bangkok.
- Functions deployed successfully in `asia-southeast1`:
  - `health`
  - `updateProfile`
  - `saveSettingsFromWeb`
  - `analyzeMeal`
  - `analyzeExercise`
  - `getDashboardData`
  - `lineWebhook`
- `getDashboardData` was deployed and tested against existing Firestore test records only. It now returns legacy-compatible aggregate arrays plus detailed Firestore `history.meals`, `history.exercises`, `history.weights`, `history.adjustments`, and per-day `daily` rows for the future dashboard/native app.
- `saveSettingsFromWeb` staging endpoint now accepts LIFF-style auto/custom settings, calculates TDEE/macros, saves `profiles`, `users`, optional `weightLogs`, `profileEvents`, links LINE/Auth IDs when provided, and grants a 3-day trial if no subscription expiry exists.
- `analyzeMeal` model is set to `gemini-3-flash-preview` to match the GAS source.
- `aiAgents/mealAnalysis` is seeded in Firestore with provider `gemini`, model `gemini-3-flash-preview`, prompt version `meal-v1`, and temperature `0.2`.
- `aiAgents/coachConsultation` is seeded in Firestore with provider `gemini`, model `gemini-3-flash-preview`, prompt version `coach-v1`, and temperature `0.4`.
- Backend now resolves canonical users through `lineLinks` and `authLinks`, so LINE OA and the future native app can share the same Firestore data after account linking.
- `lineWebhook` is staging only. It verifies signatures, deduplicates text message IDs, can analyze/reply to text food messages, and defers known legacy commands to GAS.
- `lineWebhook` staging text commands now support help, profile/status, legacy dashboard link, daily summary from Firestore, manual weight logging, and undo latest Firestore meal log.
- `lineWebhook` staging correction flow now supports latest-meal text correction and flexible portion adjustment commands such as `ไม่ใช่...เป็น...`, `กินครึ่งเดียว`, `กิน 2/3`, `เหลือ 1/4`, and `กินไป 70%` against Firestore meal logs.
- `lineWebhook` staging onboarding now handles follow events, creates/updates LINE-linked users, replies with a Flex onboarding card, supports quick manual setup with `ตั้งค่า ชื่อ 2000 40-30-30`, grants a 3-day trial for newly configured users, and gates food/image/exercise analysis until profile and subscription readiness pass.
- `lineWebhook` staging image flow now downloads LINE image content in memory, analyzes it with `aiAgents/mealAnalysis`, saves a Firestore meal log, replies with a summary, and starts best-effort LINE loading animation.
- `lineWebhook` staging meal save flow now updates `profiles.streak` using Bangkok day keys and includes the streak count in meal replies/dashboard payloads.
- `lineWebhook` staging leftover image flow now classifies leftover photos, estimates visible leftover nutrients with `aiAgents/mealAnalysis`, stores a `leftover-subtraction` adjustment, and subtracts from the latest Firestore meal log.
- `lineWebhook` staging slip flow now classifies LINE images, lets payment slips pass even when subscription is expired, creates pending `paymentReviews`, notifies admin, and updates the pending review when admin approves/rejects.
- `lineWebhook` staging BIA/file flow now accepts BIA images and PDF/image files, creates `biaReports`, analyzes them with `aiAgents/biaAnalysis`, writes weight metrics when available, and requires user confirmation before updating nutrition targets.
- `lineWebhook` staging exercise flow now detects exercise text, analyzes burn with `aiAgents/exerciseAnalysis`, falls back to a conservative rule-based estimate if the AI call fails, applies the legacy 50% safety factor, writes Firestore `exerciseLogs`, and updates daily summary/dashboard burn totals.
- `lineWebhook` staging coach/menu flow now detects advice/menu questions, uses today's Firestore summary and recent meals, replies through `aiAgents/coachConsultation`, and stores `coachConsultations` without creating food logs.
- `lineWebhook` staging contact-admin flow now forwards customer contact messages to admin LINE, stores `adminContactRequests`, and supports 30-minute admin chat sessions through `adminChatSessions`.
- `lineWebhook` staging subscription flow now supports package/QR instructions for `สมัคร/เติมวัน`, redeeming migrated codes from `redeemCodes`, and admin approve/reject commands that update `subscriptions`, `users`, and `profiles`.
- `lineWebhook` still needs a signed webhook test from a staging LINE OA before it can be marked verified.
- Health endpoint verified:
  - `https://asia-southeast1-mydietitian.cloudfunctions.net/health`
- Secrets are configured and attached to Functions:
  - `GEMINI_API_KEY`
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
  - `ADMIN_LINE_USER_ID`
- `analyzeMeal` was deployed with Gemini integration and successfully created test `aiRuns` and `mealLogs` records.
- `analyzeMeal` was rechecked after the canonical identity and AI agent config refactor and still returns `gemini-3-flash-preview` results from `aiAgents/mealAnalysis`.
- Note: the first Windows PowerShell inline JSON test garbled Thai input text, so app/LINE clients should send UTF-8 JSON bodies.
- The failed leftover `health(us-central1)` function from the first deployment attempt was deleted.
- Google Sheet data migration is intentionally deferred until the final pre-production cutover window.

## Local tooling

- Node.js available
- npm available
- Firebase CLI available
- Flutter not installed on this machine

## Decision taken

Use Expo / React Native for the initial mobile scaffold so development can begin immediately without waiting for Flutter installation.
