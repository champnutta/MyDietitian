# Manual UAT Evidence Template

Use this template for the manual gates that cannot be fully automated before final data migration. Keep production LINE OA on GAS until every required manual gate is marked `pass`.

## Test Session

| Field | Value |
| --- | --- |
| Date/time (Asia/Bangkok) |  |
| Tester |  |
| Staging LINE OA/channel |  |
| Firebase project | `mydietitian` |
| Backend endpoint | `https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook` |
| Test LINE user ID |  |
| Notes |  |

## Pre-Run Commands

Run these before manual UAT:

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager
node tools/check_ai_fallback_readiness.js --project mydietitian
node tools/check_ai_agent_runtime_config.js --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --require-anthropic-fallback
npm run line:uat-report
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager
npm run dashboard:contract
```

You can generate a local working evidence file and prefill non-secret session/rollback values:

```powershell
npm run uat:prepare-evidence -- --project mydietitian --force --tester "<YOUR_NAME>" --lineChannel "<STAGING_LINE_CHANNEL>" --testLineUserId "<TEST_LINE_USER_ID>" --currentGasWebhookUrl "<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>" --operator "<ROLLBACK_OPERATOR>"
```

If `LINE_CHANNEL_SECRET` is already stored in Secret Manager for project `mydietitian`, add `--useLineSecretManager` to run the signed webhook contract dry-run without printing the secret:

```powershell
npm run uat:prepare-evidence -- --project mydietitian --force --useLineSecretManager --tester "<YOUR_NAME>" --lineChannel "<STAGING_LINE_CHANNEL>" --testLineUserId "<TEST_LINE_USER_ID>" --currentGasWebhookUrl "<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>" --operator "<ROLLBACK_OPERATOR>"
```

This command does not migrate data and does not print secrets. The generated `docs/MANUAL_UAT_EVIDENCE.md` is intentionally ignored by Git because it may contain LINE IDs and operational notes.

When this file is copied and filled with real evidence, validate it before using readiness flags:

```powershell
npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md --phase pre-migration
```

The pre-migration evidence checker requires every pre-run `Actual` field to contain a passing result, every Real LINE Media and Real LIFF case to have `Result=pass`, evidence notes filled, rollback/cutover values filled, and the required pre-migration Cutover Decision rows to have owner sign-off.

After the approved import completes, validate the final cutover evidence before changing the production LINE webhook:

```powershell
npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md --phase cutover --parity-plan-json docs/DASHBOARD_PARITY_PLAN_OUTPUT.json
```

The cutover phase additionally requires completed dashboard parity rows for every sampled user/date window in `docs/DASHBOARD_PARITY_PLAN_OUTPUT.json` and production webhook cutover approval.

Record the latest output summary:

| Check | Expected | Actual |
| --- | --- | --- |
| Pre-cutover report | `ok=true` |  |
| Pre-migration audit | all checks pass with `--smoke-write --useLineSecretManager` |  |
| AI fallback readiness | both Gemini and Anthropic secrets ready |  |
| AI agent runtime config | `gemini-3.5-flash` primary and `claude-sonnet-4-6` fallback |  |
| LINE text dry-run | `13/13` text scenarios pass |  |
| Signed LINE webhook contract | `mode=line-webhook-contract-dry-run` |  |
| Dashboard contract | `ok=true` |  |
| Migration dry-run | `okToPreviewImport=true` |  |

Tip: `npm run line:uat-report -- --out docs/LINE_STAGING_UAT_REPORT.md` now lists the Firestore collections to inspect for each real LINE media/LIFF case.

After sending real LINE/LIFF test messages, summarize recent Firestore evidence for the staging user:

```powershell
npm run uat:firestore-evidence -- --user "<TEST_LINE_USER_ID>" --since-hours 24
```

Use the returned document IDs and checklist hints as the `Evidence link/notes` values below.

## Real LINE Media UAT

These tests must use a real LINE message because Firebase downloads content from LINE by `messageId`.

| Case | Steps | Expected Firestore evidence | Expected LINE/Admin evidence | Result | Evidence link/notes |
| --- | --- | --- | --- | --- | --- |
| Food image | Send a normal food photo from staging LINE user. | `mealLogs` created, `aiRuns` created, image source references `line-message://...`. | User receives meal summary. |  |  |
| Leftover image | Create a latest meal first, then send leftover photo. | Latest `mealLogs` updated, leftover adjustment recorded. | User receives subtraction summary. |  |  |
| Payment slip image | Send a payment slip image from expired or active test user. | `paymentReviews` created or updated with `pending-admin-review`. | Admin receives review notification. |  |  |
| Admin approve | Admin sends `approve {USER_ID} 30d` or similar. | `subscriptions` updated, `subscriptionEvents` written. | User receives approval/expiry message. |  |  |
| Admin reject | Admin sends `reject {USER_ID} test reason`. | `paymentReviews` marked rejected. | Admin receives rejection confirmation. |  |  |
| BIA image/PDF | Send BIA report image or PDF file. | `biaReports` created, `biaAnalysis` run, optional `weightLogs` written. | User receives BIA recommendation and confirm command. |  |  |
| BIA confirm | Send `CONFIRM_UPDATE_TARGET ...` from the same user. | `profiles.target` updated, `profileEvents` written. | User receives confirmation. |  |  |

## Real LIFF Auth UAT

| Case | Steps | Expected evidence | Result | Evidence link/notes |
| --- | --- | --- | --- | --- |
| LIFF settings opens | Open settings from staging LINE onboarding card. | Page opens at `https://mydietitian.web.app/settings` inside LINE. |  |  |
| LINE ID token sent | Submit settings from real LIFF session. | `saveSettingsFromWeb` returns `authVerified=true`; `profileAuthEvents` written. |  |  |
| Invalid token rejected | Submit with invalid token through controlled test only. | Endpoint returns `401 profile-auth-failed`. |  |  |

## Security Preflight

Complete these before approving the final migration window.

| Case | Steps | Expected evidence | Result | Evidence link/notes |
| --- | --- | --- | --- | --- |
| LINE channel secret rotated after exposure | Rotate `LINE_CHANNEL_SECRET` in LINE Developers Console and update Secret Manager version in project `mydietitian`. | New Secret Manager version enabled; old secret no longer used by staging tests. |  |  |

## Dashboard Parity After Preview/Final Import

Do not run this section until data has been imported into Firestore in an approved preview/final migration window.

Use `sampleUsersForDashboardParity` from the latest migration dry-run report.

Optional helper after preview/final import:

```powershell
npm run dashboard:parity-plan -- --out docs/DASHBOARD_PARITY_PLAN_OUTPUT.md --json-out docs/DASHBOARD_PARITY_PLAN_OUTPUT.json
```

| User ID | Date range | GAS calories | Firestore calories | GAS protein/carbs/fat | Firestore protein/carbs/fat | GAS weight/fat/muscle | Firestore weight/fat/muscle | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | 7 days |  |  |  |  |  |  |  |  |
|  | 30 days |  |  |  |  |  |  |  |  |
|  | custom |  |  |  |  |  |  |  |  |

## Rollback/Cutover Values

Record these values before using `--rollback-reviewed` or approving the final migration window.

| Item | Value |
| --- | --- |
| Current GAS webhook URL |  |
| Firebase webhook URL | `https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook` |
| LINE channel |  |
| Operator |  |
| Latest commit SHA |  |
| Latest Google Sheet source fingerprint |  |

## Cutover Decision

| Gate | Required result | Actual result | Owner sign-off |
| --- | --- | --- | --- |
| Automated pre-cutover report | pass |  |  |
| Real LINE media UAT | pass |  |  |
| Real LIFF auth UAT | pass |  |  |
| Dashboard parity after import | pass |  |  |
| Rollback plan reviewed | pass |  |  |
| Final data migration window approved | pass |  |  |
| Production webhook cutover approved | pass |  |  |

Final decision:

```text
Do not switch production LINE webhook until every gate above is pass.
```

Final cutover and rollback steps live in:

```text
docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md
```
