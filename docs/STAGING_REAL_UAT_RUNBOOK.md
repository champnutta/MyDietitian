# Staging Real LINE/LIFF UAT Runbook

Use this runbook to collect the manual evidence required before the final Google Sheet to Firestore migration window.

Production boundaries:

- Do not run final data migration from this runbook.
- Do not change the production LINE OA webhook from GAS.
- Run these tests only on the staging LINE OA/channel that points to Firebase `lineWebhook`.
- Keep `docs/MANUAL_UAT_EVIDENCE.md` local and uncommitted because it can contain LINE user IDs and operational notes.

## 1. Prepare The Local Evidence File

Copy the current GAS webhook URL from LINE Developers Console first, then run:

```powershell
npm run uat:prepare-evidence -- --project mydietitian --force --useLineSecretManager --tester "<YOUR_NAME>" --lineChannel "<STAGING_LINE_CHANNEL>" --testLineUserId "<TEST_LINE_USER_ID>" --currentGasWebhookUrl "<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>" --operator "<ROLLBACK_OPERATOR>"
```

Then confirm the current gate state:

```powershell
npm run gate:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --evidence-file docs\MANUAL_UAT_EVIDENCE.md
```

Expected before manual testing: automated checks pass, source tree is clean, and manual evidence rows remain missing.

If `docs\MANUAL_UAT_EVIDENCE.md` already contains real LINE/LIFF notes, refresh automated rows without overwriting manual evidence:

```powershell
npm run uat:prepare-evidence -- --project mydietitian --refresh-existing --useLineSecretManager --tester "<YOUR_NAME>" --lineChannel "<STAGING_LINE_CHANNEL>" --testLineUserId "<TEST_LINE_USER_ID>" --currentGasWebhookUrl "<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>" --operator "<ROLLBACK_OPERATOR>"
```

## 2. Real LINE Media Test Sequence

Run these from the staging LINE user recorded as `Test LINE user ID`.

| Evidence row | What to do in staging LINE | Expected user/admin reply | Firestore evidence to copy |
| --- | --- | --- | --- |
| Food image | Send a normal food photo. | User receives meal summary. | `mealLogs` and `aiRuns` latest IDs. |
| Leftover image | Send a food text/photo first, then send leftover photo. | User receives subtraction summary. | Latest `mealLogs.adjustments[]` plus related `aiRuns`. |
| Payment slip image | Send a payment slip image. | Admin receives pending review notification. | `paymentReviews` latest ID with `pending-admin-review`. |
| Admin approve | Admin sends `approve <TEST_LINE_USER_ID> 30d`. | User receives approval/expiry reply. | `subscriptionEvents` latest ID and `subscriptions` expiry. |
| Admin reject | Send another slip if needed, then admin sends `reject <TEST_LINE_USER_ID> test reason`. | Admin receives rejection confirmation. | `paymentReviews` status rejected and admin audit evidence. |
| BIA image/PDF | Send a BIA report image or PDF file. | User receives BIA recommendation and confirm command. | `biaReports`, `aiRuns`, optional `weightLogs`. |
| BIA confirm | Send the exact `CONFIRM_UPDATE_TARGET ...` command from the BIA reply. | User receives target update confirmation. | `profiles.target` updated and `profileEvents` latest ID. |

After each group, summarize evidence:

```powershell
npm run uat:firestore-evidence -- --user "<TEST_LINE_USER_ID>" --since-hours 24 --require-all --out docs\UAT_FIRESTORE_EVIDENCE.json --markdown-out docs\UAT_FIRESTORE_EVIDENCE.md
```

`--require-all` is expected to fail until every tracked category is present. The checklist now maps directly to the manual evidence rows: Food image, Leftover image, Payment slip image, Admin approve, Admin reject, BIA image/PDF, BIA confirm, LIFF settings opens, and LINE ID token sent. Use the successful or partially successful Markdown output to copy document IDs and checklist hints into `docs/MANUAL_UAT_EVIDENCE.md`. Keep generated evidence files local if they contain LINE IDs or sensitive operational notes.

After the report shows passing evidence for one or more rows, apply the passing rows into the local evidence file:

```powershell
npm run uat:apply-firestore-evidence -- --firestore-report docs\UAT_FIRESTORE_EVIDENCE.json --evidence-file docs\MANUAL_UAT_EVIDENCE.md
```

The apply command only fills rows whose Firestore checklist is already passing. It does not mark missing evidence as pass.

## 3. Real LIFF Auth Test Sequence

Run these inside the LINE app, not a normal desktop browser.

| Evidence row | What to do | Expected result | Firestore evidence to copy |
| --- | --- | --- | --- |
| LIFF settings opens | Tap the settings/onboarding card from staging LINE. | Settings page opens inside LINE. | Note the LIFF URL/session and timestamp. |
| LINE ID token sent | Submit settings from the real LIFF session. | `saveSettingsFromWeb` returns `authVerified=true`. | `profileAuthEvents` latest ID and `profiles.authVerified=true`. |
| Invalid token rejected | Run the controlled invalid-token command below. | Endpoint returns `401 profile-auth-failed`. | Copy the command JSON `evidenceText`. |

Controlled invalid-token command:

```powershell
npm run uat:liff-invalid-token -- --user "<TEST_LINE_USER_ID>"
```

This command intentionally sends a fake `X-Line-Id-Token` with a safe settings payload. Passing evidence is `401 profile-auth-failed`, which proves the endpoint rejects forged LIFF identity before writing profile data.

Summarize the Firestore evidence again:

```powershell
npm run uat:firestore-evidence -- --user "<TEST_LINE_USER_ID>" --since-hours 24 --out docs\UAT_FIRESTORE_EVIDENCE.json --markdown-out docs\UAT_FIRESTORE_EVIDENCE.md
```

## 4. Security Preflight

Because a previous local terminal output exposed the old LINE channel secret, rotate it before approving migration.

1. Rotate `LINE_CHANNEL_SECRET` in LINE Developers Console.
2. Add the new value as a new enabled Secret Manager version in project `mydietitian`.
3. Redeploy or confirm Firebase Functions can read the new secret version.
4. Generate Secret Manager metadata and signed webhook evidence without printing the secret value:

```powershell
npm run uat:line-secret-evidence -- --project mydietitian --markdown-out docs\LINE_SECRET_ROTATION_EVIDENCE.md --out docs\LINE_SECRET_ROTATION_EVIDENCE.json
```

5. Re-run the full signed webhook checks through Secret Manager:

```powershell
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager
```

Record the new Secret Manager version evidence, `secretValuePrinted=false`, and the passing audit result in `docs/MANUAL_UAT_EVIDENCE.md`. Keep generated `docs\LINE_SECRET_ROTATION_EVIDENCE.*` local.

Important: if the latest enabled version was created before the known terminal exposure, do not mark this row `pass` yet. Rotate the LINE channel secret first, add a new Secret Manager version, then rerun the command so the evidence shows the post-rotation version.

## 5. Validate Before Requesting Migration Approval

Generate an operator checklist from the same evidence rules used by the migration gate:

```powershell
npm run uat:operator-checklist -- --file docs\MANUAL_UAT_EVIDENCE.md --out docs\PRE_MIGRATION_OPERATOR_CHECKLIST.md
```

Run the evidence checker:

```powershell
npm run uat:evidence-check -- --file docs\MANUAL_UAT_EVIDENCE.md --phase pre-migration
```

Run the compact gate:

```powershell
npm run gate:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --evidence-file docs\MANUAL_UAT_EVIDENCE.md
```

Only after both are clean should the final readiness packet be generated with manual gate flags.

## 6. What Still Waits Until After Data Import

Do not complete these from this runbook:

- Final Google Sheet to Firestore write.
- Dashboard parity against imported Firestore data.
- Production LINE webhook switch.
- Production canary and rollback monitoring.

Those steps stay in `docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md`.
