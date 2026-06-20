# Region Migration Runbook: asia-southeast1 → asia-southeast3

Goal: co-locate the Cloud Functions backend with Firestore in `asia-southeast3`
(Bangkok) to remove cross-region latency on the many sequential Firestore
reads/writes each LINE event triggers, and to keep data and compute inside
Thailand.

This runbook covers the region move only. It stops at the point where the
production LINE OA webhook would be switched from GAS to Firebase. The actual
production webhook switch remains gated by `docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md`
(real UAT, data migration, owner approval). Do the region move first, while LINE
production still points at GAS, so it costs nothing to real users.

## Why now

- The move only changes one source line for the backend
  (`services/backend/src/runtime.ts`).
- Cloud Functions (2nd gen / Cloud Run) is available in `asia-southeast3`.
- Doing it before the production cutover means LINE Console is touched once, not
  twice. Moving region after cutover would require a second production webhook
  change.

## Important: a region move is a redeploy, not an in-place edit

Gen 2 functions are addressed by region. Changing the region deploys new
function instances at new URLs:

- Old: `https://asia-southeast1-mydietitian.cloudfunctions.net/<fn>`
- New: `https://asia-southeast3-mydietitian.cloudfunctions.net/<fn>`

The old `asia-southeast1` functions are not removed automatically. There is a
window where both regions exist; use it to verify `asia-southeast3` before
deleting `asia-southeast1`.

## Source changes already applied

- `services/backend/src/runtime.ts`: `setGlobalOptions({ region: "asia-southeast3" })`.
- `apps/liff/public/config.js`: new shared `window.MD_FUNCTIONS_BASE` pointing at
  `asia-southeast3`; `dashboard.html` and `settings.html` now read from it.
- `tools/functions-base.js`: single source of truth for the tooling base URL,
  defaulting to `asia-southeast3`, overridable with `MD_FUNCTIONS_BASE` /
  `MD_FUNCTIONS_REGION` env vars. All region-aware tools read from it.
- `docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md`: recorded Firebase webhook target
  is now the `asia-southeast3` URL.

During the transition, point tools back at the old region without code changes:

```powershell
$env:MD_FUNCTIONS_BASE = "https://asia-southeast1-mydietitian.cloudfunctions.net"
```

Unset it (`Remove-Item Env:MD_FUNCTIONS_BASE`) once `asia-southeast3` is live.

## Deploy steps

1. Confirm the working tree builds:

   ```powershell
   npm --workspace @mydietitian/backend run build
   ```

2. Deploy functions to `asia-southeast3` (this creates the new-region instances;
   the old `asia-southeast1` instances still exist):

   ```powershell
   firebase deploy --only functions --project mydietitian
   ```

   If the CLI offers to delete the `asia-southeast1` functions during this
   deploy, decline for now so there is a verified fallback. Delete them only in
   step 6.

3. Smoke-test the new region directly (before repointing any client):

   ```powershell
   curl https://asia-southeast3-mydietitian.cloudfunctions.net/health
   $env:MD_FUNCTIONS_BASE = "https://asia-southeast3-mydietitian.cloudfunctions.net"
   npm run test:line-webhook -- --webhookDryRun --useLineSecretManager
   npm run dashboard:contract
   ```

4. Deploy hosting so the LIFF pages pick up `asia-southeast3` from `config.js`:

   ```powershell
   firebase deploy --only hosting --project mydietitian
   ```

   Deploy functions and hosting in the same window so the pages never call a
   region that is not deployed. A combined `firebase deploy` also works once the
   new region is verified.

5. Verify the LIFF pages end to end from inside LINE (settings save + dashboard
   load) against `asia-southeast3`.

6. Delete the retired `asia-southeast1` functions only after the new region is
   verified:

   ```powershell
   firebase functions:delete health updateProfile saveSettingsFromWeb getDashboardData analyzeMeal analyzeExercise lineWebhook --region asia-southeast1 --project mydietitian
   ```

7. Regenerate any evidence/checklist artifacts so their recorded endpoints and
   webhook URLs reflect `asia-southeast3` (these files were intentionally left
   unedited so the region change is captured through the normal helpers, not by
   hand):

   ```powershell
   npm run status:backend-migration -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write --useLineSecretManager --out docs\BACKEND_MIGRATION_STATUS_PACK.md --json-out docs\BACKEND_MIGRATION_STATUS_PACK.json
   npm run uat:prepare-evidence -- --project mydietitian --refresh-existing --useLineSecretManager --tester "<YOUR_NAME>" --lineChannel "<STAGING_LINE_CHANNEL>" --testLineUserId "<TEST_LINE_USER_ID>" --currentGasWebhookUrl "<CURRENT_GAS_WEBHOOK_URL_FROM_LINE_CONSOLE>" --operator "<ROLLBACK_OPERATOR>"
   ```

## Verification checklist before continuing to production cutover

- `health` on `asia-southeast3` returns ok.
- Signed LINE webhook dry-run passes against `asia-southeast3`.
- Dashboard contract check passes against `asia-southeast3`.
- LIFF settings save and dashboard load work from inside LINE against
  `asia-southeast3`.
- `asia-southeast1` functions are deleted (no stale endpoint can receive LINE
  traffic by mistake).
- README and evidence artifacts show `asia-southeast3` endpoints.

## Then, and only then

Continue with `docs/PRODUCTION_CUTOVER_ROLLBACK_RUNBOOK.md`. The production LINE
OA webhook switch from GAS to Firebase happens there, after real UAT, the final
Google Sheet → Firestore migration, dashboard parity, and owner approval. When
that step runs, the webhook target is the `asia-southeast3` URL.
