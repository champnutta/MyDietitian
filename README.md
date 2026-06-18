# Mydietitian

Fast-track migration workspace for moving the current Google Apps Script + Google Sheets + LINE OA nutrition coach into a mobile-first product with Firebase as the shared backend.

## Planned stack

- Mobile app: Expo / React Native
- Backend: Firebase Functions
- Database: Firestore
- Storage: Firebase Storage
- Notifications: Firebase Cloud Messaging
- Legacy bridge: LINE OA webhook integration

## Workspace layout

- `apps/mobile` - mobile app scaffold
- `services/backend` - Firebase Functions scaffold
- `docs` - architecture, migration, and execution notes
- `GAS data` - current legacy source snapshot

## Current status

- Git repo is connected to `https://github.com/champnutta/MyDietitian.git`.
- Firebase project `mydietitian` is linked.
- Firestore Standard edition is live in `asia-southeast3 (Bangkok)`.
- Firebase Functions are live in `asia-southeast1 (Singapore)`.
- Flutter is not installed on this machine, so the initial scaffold uses Expo / React Native for faster local startup.

## Deployed endpoints

- Health: `https://asia-southeast1-mydietitian.cloudfunctions.net/health`
- Update profile: `https://asia-southeast1-mydietitian.cloudfunctions.net/updateProfile`
- Analyze meal: `https://asia-southeast1-mydietitian.cloudfunctions.net/analyzeMeal`
- Dashboard data: `https://asia-southeast1-mydietitian.cloudfunctions.net/getDashboardData`
- LINE webhook staging receiver: `https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook`

## Backend progress

- AI calls are backend-only and use Secret Manager in the Firebase/GCP project `mydietitian`.
- `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` must both exist in `mydietitian`; do not rely on a duplicate or AI-Studio-generated project with a similar display name.
- `aiAgents/{agentId}` in Firestore controls provider/model settings. Current primary is Gemini `gemini-3.5-flash`; current fallback is Anthropic `claude-sonnet-4-6`.
- `analyzeMeal` writes both `aiRuns` and `mealLogs` in Firestore, including provider/model audit metadata and whether fallback was used.
- `lineWebhook` verifies LINE signatures, deduplicates events, and supports the migrated Firestore staging flows for onboarding, subscriptions, text/image food, corrections, portion adjustments, leftovers, exercise, BIA/file, slips, coach/menu, weight, redeem codes, contact-admin, and admin approve/reject.
- `getDashboardData` is available for post-migration dashboard verification against Firestore data.
- Text requests should be sent as UTF-8 JSON. Some Windows PowerShell inline JSON tests can garble Thai text.
- Google Sheet data migration is intentionally deferred until the final pre-production cutover window.
- AI model/provider changes should be made through Firestore `aiAgents/{agentId}` config and then verified with `node tools/check_ai_agent_runtime_config.js --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --require-anthropic-fallback`.

## Production warning

Do not switch the production LINE OA webhook from GAS to this Firebase endpoint until real LINE/LIFF UAT, Google Sheet data migration, dashboard parity, rollback values, and owner approval are complete. The current Firebase `lineWebhook` is staging/pre-production only.

## Immediate next steps

1. Finish real LINE media/file/slip/BIA UAT from a staging LINE channel.
2. Finish real LIFF auth verification from inside LINE.
3. Record rollback values, including the current GAS webhook URL, LINE channel, and operator.
4. Generate the final readiness packet immediately before the approved migration window.
5. Run Google Sheet to Firestore data migration only as the final pre-production step, then verify dashboard parity before switching production LINE OA.
