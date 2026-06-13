# Pre-Migration Readiness Audit

Use this before any Google Sheet write migration.

```bash
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json"
```

Optional smoke write with a test user:

```bash
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write
```

The audit checks:

- `health` Function.
- Hosted LIFF settings page.
- Hosted Firestore dashboard page.
- CORS preflight for `saveSettingsFromWeb` and `getDashboardData`.
- Dashboard API contract shape and array-length consistency.
- Optional test profile save and dashboard API read.
- Firestore `appConfig/runtime`.
- Dashboard bridge guard: `legacyGasDashboardUrl` must still point to the GAS dashboard before data migration and dashboard parity.
- Legacy GAS dashboard bridge remains reachable while production users still depend on GAS/Sheets.
- Firestore `aiAgents/*`.
- Firestore `subscriptionPlans/*`.
- LINE staging UAT dry-run report for signed text webhook payload generation.
- Google Sheet migration dry-run mapping for users, profiles, subscriptions, LINE links, meals, exercises, weights, redeem codes, and data-quality warnings.
- Migration write lock still refuses `--commit` without `--confirmFinalMigration` and typed `--confirmText FINAL_MIGRATION_MYDIETITIAN`.

Passing this audit does not mean production cutover is complete. It only proves the pre-migration technical surfaces are reachable and guarded. Real LINE OA media/file/slip/BIA UAT and dashboard data verification are still required before the final migration window.

For a single consolidated pre-cutover report, use:

```bash
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json"
```
