# Firestore Dashboard Replacement

Firebase Hosting now serves a dashboard preview:

```text
https://mydietitian.web.app/dashboard?uid={LINE_USER_ID}
```

The page calls:

```text
https://asia-southeast1-mydietitian.cloudfunctions.net/getDashboardData
```

## Current Status

- Hosted page is deployed.
- CORS preflight from `https://mydietitian.web.app` is verified.
- API POST from the hosted origin is verified with a staging test user.
- The page renders the existing dashboard contract: `labels`, `macros`, `bodyData`, `tdeeLine`, `stats`, `profile`, `current`, and recent `history.meals`.
- The dashboard API contract can be checked without writing data:

```powershell
npm run dashboard:contract
```

This validates response shape and array lengths for labels, calories, macros, body data, TDEE line, daily rows, stats, and detailed history arrays.

After preview/final import, generate a sampled parity checklist from the latest Google Sheet dry-run:

```powershell
npm run dashboard:parity-plan -- --out docs/DASHBOARD_PARITY_PLAN_OUTPUT.md --json-out docs/DASHBOARD_PARITY_PLAN_OUTPUT.json
```

This creates user-specific Firestore/GAS dashboard links plus 7, 30, 90, and 365 day API windows to compare calories, macros, exercise burn, weight, body fat, muscle, and recent history before switching LINE dashboard links. The cutover evidence checker uses the JSON file to require passing parity rows for every sampled user/window.

## Not Switched Yet

LINE dashboard links still use `appConfig/runtime.legacyGasDashboardUrl`, which currently points to the GAS dashboard.

The pre-migration audit intentionally fails if this bridge is switched to `https://mydietitian.web.app/dashboard` before data migration and dashboard parity are complete. It also checks that the GAS dashboard bridge remains reachable while production users still depend on GAS/Sheets.

Do not switch this config to the hosted dashboard until:

1. Google Sheet data is imported into Firestore in a preview/final migration window.
2. Sample users match GAS dashboard totals for calories, macros, weights, body fat, muscle, and date ranges.
3. LINE UAT confirms the dashboard opens from chat on mobile.

When ready, update:

```json
{
  "legacyGasDashboardUrl": "https://mydietitian.web.app/dashboard"
}
```

The backend will append `?uid={LINE_USER_ID}` automatically.
