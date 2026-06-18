# Pre-Migration Readiness Audit

Use this before any Google Sheet write migration.

```powershell
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --useLineSecretManager
```

Optional smoke write with a test user:

```powershell
npm run audit:pre-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager
```

`--useLineSecretManager` reads `LINE_CHANNEL_SECRET` from Secret Manager only inside the audit process so the signed LINE webhook contract is checked without printing the secret.

Do not pass the LINE channel secret as a command-line argument. Some shells and package runners echo arguments to logs.

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
- Signed LINE webhook contract dry-run when `LINE_CHANNEL_SECRET` is available through Secret Manager or the process environment.
- Firestore index coverage for dashboard range queries, latest-meal lookups, payment review lookups, and post-migration import verification.
- Google Sheet migration dry-run mapping for users, profiles, subscriptions, LINE links, meals, exercises, weights, redeem codes, and data-quality warnings.
- Migration write lock still refuses `--commit` without `--confirmFinalMigration`, typed `--confirmText FINAL_MIGRATION_MYDIETITIAN`, a readiness packet, and embedded post-migration verification commands.

Passing this audit does not mean production cutover is complete. It only proves the pre-migration technical surfaces are reachable and guarded. Real LINE OA media/file/slip/BIA UAT and dashboard data verification are still required before the final migration window.

The manual evidence checker also requires Security Preflight evidence. Because `LINE_CHANNEL_SECRET` was previously exposed in local terminal output, rotate it in LINE Developers Console, add the new Secret Manager version, rerun the signed webhook contract, and record the result before approving a migration window.

For a single consolidated pre-cutover report, use:

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --useLineSecretManager
```
