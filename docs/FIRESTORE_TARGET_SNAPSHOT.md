# Firestore Target Snapshot

Use this read-only snapshot before the final Google Sheet migration window to understand what already exists in Firestore target collections.

```powershell
npm run firestore:target-snapshot -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json"
```

The snapshot checks tracked collections such as:

- `users`, `profiles`, `subscriptions`, `lineLinks`, `authLinks`
- `mealLogs`, `exerciseLogs`, `weightLogs`, `redeemCodes`
- `aiRuns`, `paymentReviews`, `biaReports`, `coachConsultations`
- `profileEvents`, `subscriptionEvents`, `adminAuditLogs`, `lineEvents`, `lineEventDedup`

For each collection it reports:

- `total`: total documents.
- `legacyImported`: documents already marked with `legacy.importedFrom = google-sheet`.
- `testLike`: approximate count of test-like documents in the first 500 documents scanned.

Before final migration:

- `legacyImportAlreadyPresent` should normally be `false` unless a controlled preview/final import has already happened.
- Any unexpected non-test production-looking records should be reviewed before write migration.
- This command does not write, delete, or mutate Firestore data.
