# Pre-Cutover Report

Use this report before the final Google Sheet migration window. It does not write production customer data and does not switch the production LINE webhook.

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json"
```

Optional Markdown output:

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --out docs/PRE_CUTOVER_REPORT_OUTPUT.md
```

Optional smoke-write test user:

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write
```

The report combines:

- Pre-migration readiness audit.
- Google Sheet migration dry-run and data-quality report.
- Dashboard API contract check.
- LINE staging UAT dry-run report.
- Firestore target collection snapshot before migration.
- Suggested sample users for dashboard parity.
- Manual gates that still require real LINE OA or final cutover action.

Manual gates intentionally remain outside automation:

- Real LINE media UAT for food image, leftover image, payment slip, and BIA image/file.
- Real LIFF auth UAT proving `authVerified: true`.
- Dashboard parity against GAS after preview/final import.
- Production webhook cutover approval.

Use `docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md` to record evidence for the manual gates. The production webhook should not be moved from GAS to Firebase until every manual gate is marked `pass`.

Use `docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md` for the final webhook switch and rollback procedure after data migration and dashboard parity are verified.
