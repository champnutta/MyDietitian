# Production Cutover and Rollback Runbook

Use this runbook only after the approved final data migration window. Do not move the production LINE OA webhook from GAS to Firebase until every gate below is marked `pass`.

## Non-Negotiable Preconditions

- Latest `npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write` is `ok=true`.
- Latest `npm run migration:readiness-packet -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --evidence-file docs/MANUAL_UAT_EVIDENCE.md --manual-line-media-pass --manual-liff-auth-pass --rollback-reviewed --owner-approval` says `ready-for-final-data-migration-window`.
- A completed `docs/MANUAL_UAT_EVIDENCE.md` copied from the template has pass evidence for real LINE media UAT.
- Real LIFF settings UAT returns `authVerified=true`.
- Final Google Sheet migration is complete and verified.
- Firestore dashboard parity matches GAS dashboard for sampled users and date ranges.
- Owner explicitly approves the production webhook switch.

## Values to Record Before Cutover

Record these values in the cutover notes before changing anything:

| Item | Value |
| --- | --- |
| Current GAS webhook URL |  |
| Firebase webhook URL | `https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook` |
| LINE channel |  |
| Cutover start time (Asia/Bangkok) |  |
| Operator |  |
| Latest commit SHA |  |
| Latest pre-cutover report result |  |
| Latest migration document counts |  |

## Cutover Steps

1. Pause non-essential code changes.
2. Run the pre-cutover report with `--smoke-write`.
3. Confirm production GAS remains healthy.
   The automated pre-cutover report checks the legacy GAS dashboard bridge, but still record the current GAS webhook URL before changing LINE Console.
4. Confirm Firebase health endpoint is healthy.
5. Confirm `appConfig/runtime.productionLineWebhookReady` is still `false` before the final switch.
6. Complete final Google Sheet to Firestore migration using the locked write command only inside the approved window:

```powershell
npm run migrate:sheets:dry-run -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --commit --confirmFinalMigration --confirmText FINAL_MIGRATION_MYDIETITIAN
```

This command is intentionally wordy. Do not shorten it; the typed confirmation prevents accidental writes before the final migration window.

7. Run the pre-cutover report again with `--smoke-write`.
8. Run dashboard parity checks for sampled users.
9. Run real LINE staging media and LIFF auth tests one final time.
10. In LINE Developers Console, change the production webhook URL to Firebase.
11. Send a production canary message from an internal LINE user.
12. Watch Firestore `lineEvents`, `lineEventDedup`, `adminAuditLogs`, `aiRuns`, `mealLogs`, and `paymentReviews` for unexpected errors.
13. Keep the old GAS webhook URL ready for immediate rollback.

## Canary Tests After Switch

Run only with internal/test users first:

| Case | Expected result | Result |
| --- | --- | --- |
| Follow or profile/status command | LINE replies normally and Firestore logs event. |  |
| Text food | `mealLogs` and `aiRuns` created; user receives summary. |  |
| Dashboard command | User receives intended dashboard link. |  |
| Exercise text | `exerciseLogs` created; summary includes burn. |  |
| Payment/subscription command | User receives package/QR guidance. |  |
| Admin contact command | Admin receives forwarded message. |  |

## Rollback Triggers

Rollback immediately if any of these occur:

- LINE users receive no reply or repeated errors.
- Signature verification or LINE API calls fail broadly.
- Food/image/slip/BIA flows create incorrect or duplicate records.
- Dashboard links point to the wrong source or expose wrong user data.
- Admin cannot approve/reject subscriptions.
- Error rate or user complaints spike during the canary window.

## Rollback Steps

1. In LINE Developers Console, restore the production webhook URL to the recorded GAS webhook URL.
2. Send an internal canary message to confirm GAS replies.
3. Stop further Firebase cutover testing.
4. Record rollback time, trigger, affected users, and observed Firestore logs.
5. Do not reattempt cutover until the root cause is fixed and the full pre-cutover report plus manual UAT gates pass again.

## Post-Cutover Monitoring

For the first production window, monitor:

- LINE reply success and admin error notifications.
- `adminAuditLogs` for `line-webhook-staging-error`.
- New `mealLogs`, `exerciseLogs`, `weightLogs`, `paymentReviews`, and `subscriptionEvents`.
- AI latency and failures in `aiRuns`.
- Dashboard behavior for sampled active users.
- Any customer reports from LINE OA.

## Final Rule

If there is doubt, keep or roll back to GAS. Firebase should become production only after the migration, manual UAT evidence, dashboard parity, and canary tests all prove it is safer than the current GAS path.
