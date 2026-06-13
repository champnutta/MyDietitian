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
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write
npm run line:uat-report
npm run dashboard:contract
```

Record the latest output summary:

| Check | Expected | Actual |
| --- | --- | --- |
| Pre-cutover report | `ok=true` |  |
| Pre-migration audit | all checks pass with `--smoke-write` |  |
| LINE text dry-run | `13/13` text scenarios pass |  |
| Dashboard contract | `ok=true` |  |
| Migration dry-run | `okToPreviewImport=true` |  |

Tip: `npm run line:uat-report -- --out docs/LINE_STAGING_UAT_REPORT.md` now lists the Firestore collections to inspect for each real LINE media/LIFF case.

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

## Dashboard Parity After Preview/Final Import

Do not run this section until data has been imported into Firestore in an approved preview/final migration window.

Use `sampleUsersForDashboardParity` from the latest migration dry-run report.

Optional helper after preview/final import:

```powershell
npm run dashboard:parity-plan -- --out docs/DASHBOARD_PARITY_PLAN_OUTPUT.md
```

| User ID | Date range | GAS calories | Firestore calories | GAS protein/carbs/fat | Firestore protein/carbs/fat | GAS weight/fat/muscle | Firestore weight/fat/muscle | Result | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
|  | 7 days |  |  |  |  |  |  |  |  |
|  | 30 days |  |  |  |  |  |  |  |  |
|  | custom |  |  |  |  |  |  |  |  |

## Cutover Decision

| Gate | Required result | Actual result | Owner sign-off |
| --- | --- | --- | --- |
| Automated pre-cutover report | pass |  |  |
| Real LINE media UAT | pass |  |  |
| Real LIFF auth UAT | pass |  |  |
| Dashboard parity after import | pass |  |  |
| Rollback plan reviewed | pass |  |  |
| Production webhook cutover approved | pass |  |  |

Final decision:

```text
Do not switch production LINE webhook until every gate above is pass.
```

Final cutover and rollback steps live in:

```text
docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md
```
