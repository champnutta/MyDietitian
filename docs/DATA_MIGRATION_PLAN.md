# Google Sheet to Firestore Migration Plan

This migration must be non-destructive. The GAS production bot and Google Sheet remain untouched during import.

## Current decision

Do not run a write migration now. Migration is intentionally deferred until the final step before production cutover, because customers are still actively using the GAS + Google Sheet system.

## Sheet tabs to migrate

| Sheet tab | Firestore target | Notes |
| --- | --- | --- |
| `Users` | `users`, `profiles`, `subscriptions`, `lineLinks` | LINE user ID becomes the first `canonicalUserId` until a native app account is linked. |
| `Log` | `mealLogs`, `exerciseLogs` | Main active food/exercise history. |
| `Logs_Archive_*` | `mealLogs`, `exerciseLogs` | Historical archived logs. |
| `Weight_Log` | `weightLogs` | Weight and body composition history. |
| `Codes` | `redeemCodes` | Subscription/redeem code state. |

## Inferred GAS headers

### `Users`

```text
UserID, Name, TDEE, P_%, C_%, F_%, Expire_Date, Last_Update, Streak
```

### `Log` and `Logs_Archive_*`

```text
Date, UserID, Dish_TH, Dish_EN_or_Type, Portion, Calories, Protein, Carbs, Fat, Fiber, Sugar, Score, Comment
```

Exercise rows are inferred from column 4 containing `Exercise` or `Burn`.

### `Weight_Log`

```text
Date, UserID, Weight_kg, BodyFat_%, MuscleMass_kg, Device
```

### `Codes`

```text
Code, Days, Status, Used_By, Used_Date
```

## Migration safety

- Start with dry-run only.
- Use the dry-run readiness report to inspect tab fetch errors, missing headers, duplicate users, invalid dates, invalid numbers, macro percent issues, and source-vs-target document counts.
- Keep write mode locked until final production migration.
- Count rows by tab before writing.
- Generate deterministic Firestore document IDs from source tab + row number.
- Preserve and write `canonicalUserId` so LINE OA and native app can share the same user record later.
- Preserve `legacy` metadata on each imported document.
- Never delete or mutate Google Sheet rows during migration.
- Keep GAS production running until imported dashboard and LINE flows are verified.

## First import scope

1. `Users`
2. `Log`
3. `Logs_Archive_*`
4. `Weight_Log`
5. `Codes`

## Write command lock

The migration script refuses to write unless every final-readiness guard is present:

```powershell
npm run migrate:sheets:dry-run -- --commit --confirmFinalMigration --confirmText FINAL_MIGRATION_MYDIETITIAN --readinessPacket docs/FINAL_MIGRATION_READINESS_PACKET.json
```

Do not use this command until the production migration window is approved.

The typed `--confirmText` guard and `--readinessPacket` guard intentionally prevent accidental writes from copied partial commands or from running before readiness evidence is complete.

## Dry-run readiness report

Run this any time before the final migration window. It reads the Google Sheet and plans deterministic Firestore documents, but does not write anything.

```powershell
npm run migrate:sheets:dry-run -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json"
```

The output includes:

- `tabStats`: row counts, detected headers, and missing expected headers per tab.
- `sourceSummary`: source row counts split by users, active logs, archived logs, exercise-like rows, meal-like rows, weights, and codes.
- `countByCollection`: planned Firestore writes by collection.
- `sampleUsersForDashboardParity`: suggested LINE users to compare between GAS dashboard and Firestore dashboard after preview/final import.
- `dataQuality.okToPreviewImport`: `true` only when no high-severity issue is detected.
- `dataQuality.warnings`: sampled warnings such as missing `UserID`, invalid dates, invalid numbers, bad macro totals, duplicate users, or tab fetch errors.

Use `--sampleLimit 20` if you want more example rows in the warning output.

## Verification checklist

- Imported user count matches `Users` non-empty row count.
- Imported food/exercise count matches `Log` + archive non-empty row count.
- Imported weight count matches `Weight_Log` non-empty row count.
- Dashboard totals match GAS dashboard for sampled users and date ranges.
- Use `sampleUsersForDashboardParity` from the latest dry-run report to pick users with active subscriptions, many logs, exercise rows, and weight/body-composition history.
- Subscription expiry matches existing user profile output.
- After the final write migration, run the hosted Firestore dashboard for sampled users before changing LINE dashboard links.
