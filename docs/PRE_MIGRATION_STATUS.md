# Pre-Migration Status

Last updated: 2026-06-19

This project is ready for continued staging UAT, but it is not ready for final Google Sheet data migration or production LINE webhook cutover yet.

## Current Production Boundary

- Production LINE OA remains on GAS.
- Google Sheet remains the production source of truth.
- Firestore is ready as the target database, but final import is intentionally deferred.
- Firebase `lineWebhook` is staging/pre-production only.
- Native app development remains a later phase after the shared backend is stable for both LINE OA and native clients.

## Backend Status

- Firebase project: `mydietitian`.
- Firestore database: `(default)` in `asia-southeast3 (Bangkok)`.
- Firebase Functions region: `asia-southeast1`.
- Deployed functions: `health`, `updateProfile`, `saveSettingsFromWeb`, `getDashboardData`, `analyzeMeal`, `analyzeExercise`, and `lineWebhook`.
- Firestore dashboard preview is deployed through Firebase Hosting.

## AI Provider Status

- AI provider configuration lives in Firestore `aiAgents/{agentId}`.
- Active agents: `mealAnalysis`, `exerciseAnalysis`, `biaAnalysis`, and `coachConsultation`.
- Primary provider/model: Gemini `gemini-3.5-flash`.
- Fallback provider/model: Anthropic `claude-sonnet-4-6`.
- Both `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` must be stored in Secret Manager under the same Firebase/GCP project: `mydietitian`.
- AI audit metadata is written to `aiRuns` and related logs, including `primaryProvider`, `primaryModel`, `provider`, `model`, and `fallbackUsed`.

## Latest Automated Evidence

- Latest source commit must be read from `git rev-parse HEAD` when generating the final readiness packet.
- Final migration tooling now requires the readiness packet and the write-time source tree to be clean and commit-matched before any `--commit` import can run.
- Pre-migration audit passed with smoke-write enabled and Secret Manager-backed LINE signature verification: 18 passed, 0 failed, 0 skipped.
- The latest readiness packet run still holds before data migration because the manual evidence file is incomplete.
- Manual evidence validation now rejects pre-migration audit evidence unless it explicitly records `0 failed` and `0 skipped`.
- Firestore UAT evidence summary supports `--require-all` so real LINE/LIFF evidence collection fails fast until every tracked evidence category is present.
- AI agent runtime config check passed with Anthropic fallback required.
- AI fallback smoke test passed: Gemini primary failed over successfully to Claude and recorded `fallbackUsed=true`.
- Migration dry-run planned 11,955 Firestore documents from the current Google Sheet snapshot.
- Migration dry-run source fingerprint: `f49487fbc77d405e6b59b62884510bcd0866d7968a655db3e046b72671c918f1`.
- Expected import run ID from the dry-run fingerprint: `google_sheet_f49487fbc77d`.
- Firestore target risk was low and no legacy imported documents were detected.

## Remaining Manual Gates

- Real LINE media/file UAT: food image, leftover image, payment slip, BIA image/PDF/file.
- Real LINE text UAT: exercise, coach/menu, subscription/redeem/admin flows as needed.
- Real LIFF settings and identity/auth verification from inside LINE.
- Security preflight: rotate `LINE_CHANNEL_SECRET` after the local terminal exposure and record the new Secret Manager version evidence.
- Rollback values: current GAS webhook URL, Firebase webhook URL, LINE channel, operator, latest commit SHA, and current Google Sheet fingerprint.
- Owner approval for the final migration window.
- Dashboard parity after imported Firestore data exists.
- Owner approval for production LINE webhook cutover.

## Current Hold Reasons

- Do not run final data migration yet: readiness packet status is still `hold-before-data-migration`.
- Manual UAT evidence is incomplete for real LINE media, real LIFF auth, security preflight, rollback fields, and owner sign-off.
- Rotate `LINE_CHANNEL_SECRET` and record the new Secret Manager version evidence before approving production migration/cutover.
- Re-run readiness with `--useLineSecretManager` so the automated pre-migration audit has `skipped=0` without printing `LINE_CHANNEL_SECRET`.
- Update `docs/MANUAL_UAT_EVIDENCE.md` with the current `git rev-parse HEAD` value after regenerating/preparing evidence.
- Use `docs/STAGING_REAL_UAT_RUNBOOK.md` for the staging-only real LINE/LIFF evidence sequence before requesting the final migration window.

## Safe Commands

Use these commands to recheck readiness without migrating data:

One-page backend migration status pack:

```powershell
npm run status:backend-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --out docs\BACKEND_MIGRATION_STATUS_PACK.md --json-out docs\BACKEND_MIGRATION_STATUS_PACK.json
```

This consolidates deployed Firebase Functions, AI provider fallback config, LINE text UAT, Google Sheet dry-run counts, and the pre-migration gate. It does not write migrated data or switch the production LINE webhook.

```powershell
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager
```

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager
```

```powershell
npm run migration:readiness-packet -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --evidence-file docs\MANUAL_UAT_EVIDENCE.md
```

Compact gate summary for day-to-day checks:

```powershell
npm run gate:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --evidence-file docs\MANUAL_UAT_EVIDENCE.md
```

This summary also includes operator checklist hints such as stale commit evidence and suggested next commands.
To save a local ignored snapshot:

```powershell
npm run gate:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --evidence-file docs\MANUAL_UAT_EVIDENCE.md --out docs\PRE_MIGRATION_GATE_SUMMARY.md --json-out docs\PRE_MIGRATION_GATE_SUMMARY.json
```

```powershell
node tools\check_ai_agent_runtime_config.js --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --require-anthropic-fallback
```

```powershell
npm run uat:remaining -- --file docs\MANUAL_UAT_EVIDENCE.md --phase pre-migration
```

Prefill local manual evidence after copying the current GAS webhook URL from LINE Developers Console:

```powershell
npm run uat:prepare-evidence -- --project mydietitian --force --useLineSecretManager --tester "<YOUR_NAME>" --lineChannel "<STAGING_LINE_CHANNEL>" --testLineUserId "<TEST_LINE_USER_ID>" --currentGasWebhookUrl "<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>" --operator "<ROLLBACK_OPERATOR>"
```

This reads `LINE_CHANNEL_SECRET` from Secret Manager for the signed webhook contract row without printing the secret.

Do not run the final migration write command until the readiness packet has no blockers and the migration window is approved.
