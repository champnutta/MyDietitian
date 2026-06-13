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

## Not Switched Yet

LINE dashboard links still use `appConfig/runtime.legacyGasDashboardUrl`, which currently points to the GAS dashboard.

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
