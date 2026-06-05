# Google Sheet to Firestore Migration Plan

This migration must be non-destructive. The GAS production bot and Google Sheet remain untouched during import.

## Current decision

Do not run a write migration now. Migration is intentionally deferred until the final step before production cutover, because customers are still actively using the GAS + Google Sheet system.

## Sheet tabs to migrate

| Sheet tab | Firestore target | Notes |
| --- | --- | --- |
| `Users` | `users`, `profiles`, `subscriptions`, `lineLinks` | LINE user ID is currently the primary ID. |
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
- Keep write mode locked until final production migration.
- Count rows by tab before writing.
- Generate deterministic Firestore document IDs from source tab + row number.
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

The migration script refuses to write unless both flags are present:

```powershell
npm run migrate:sheets:dry-run -- --commit --confirmFinalMigration
```

Do not use this command until the production migration window is approved.

## Verification checklist

- Imported user count matches `Users` non-empty row count.
- Imported food/exercise count matches `Log` + archive non-empty row count.
- Imported weight count matches `Weight_Log` non-empty row count.
- Dashboard totals match GAS dashboard for sampled users and date ranges.
- Subscription expiry matches existing user profile output.
