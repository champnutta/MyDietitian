# Functions Region: asia-southeast1 vs asia-southeast3 (Finding)

## Summary

Firebase Functions stay in `asia-southeast1` (Singapore). Co-locating them with
Firestore in `asia-southeast3` (Bangkok) is **not currently possible** on this
project, even though that would remove cross-region latency on the many
sequential Firestore reads/writes each LINE event triggers.

## What was verified (2026-06-20)

- Firestore `(default)` database location: `asia-southeast3` (confirmed via
  `gcloud firestore databases describe`).
- **Cloud Run** supported regions include `asia-southeast3`
  (`gcloud run regions list`).
- **Cloud Functions v2** supported locations for this project are only
  `asia-southeast1`, `asia-southeast2`, `australia-southeast1`
  (`gcloud functions regions list`) — `asia-southeast3` is **not** offered.
- A `firebase deploy --only functions` targeting `asia-southeast3` failed:

  ```
  HTTP 403: Location asia-southeast3 is not found or access is unauthorized
  (cloudfunctions.googleapis.com/v2/.../locations/asia-southeast3/functions:generateUploadUrl)
  ```

  The deploy failed before creating anything, so the live `asia-southeast1`
  functions were never touched.

## Why the confusion

Gen 2 functions run *on* Cloud Run, and Cloud Run supports `asia-southeast3`.
But Firebase Functions deploy and manage them through the **Cloud Functions v2**
control plane (`cloudfunctions.googleapis.com`), which does not yet expose
`asia-southeast3`. "Cloud Run supports Bangkok" does not imply "Firebase
Functions can deploy to Bangkok."

## Decision

- Keep Functions in `asia-southeast1`. Accept the Singapore↔Bangkok cross-region
  hop to Firestore (single-digit-to-low-tens of ms per round trip).
- The configuration was still centralized so a future move is a one-line change:
  - `services/backend/src/runtime.ts` — region in one `setGlobalOptions` call.
  - `tools/functions-base.js` — single base URL for tooling, env-overridable via
    `MD_FUNCTIONS_BASE` / `MD_FUNCTIONS_REGION`.
  - `apps/liff/public/config.js` — single base URL for the LIFF pages.

## Options if co-location ever becomes a hard requirement

1. **Wait for Cloud Functions v2 to add `asia-southeast3`**, then change the
   region in the three places above and redeploy (functions first, smoke test,
   hosting, then delete the old-region functions).
2. **Deploy the backend as native Cloud Run services in `asia-southeast3`**
   instead of Firebase Functions. Cloud Run supports Bangkok today, but this
   means leaving the `firebase-functions/v2` framework: own the container build,
   wire Secret Manager and IAM manually, and replace the Hosting/function URL
   wiring. Larger change — only worth it if cross-region latency or Thai data
   residency for compute becomes a real constraint.
3. **Reduce cross-region chattiness** in `lineWebhook` (batch/parallelize
   Firestore reads, cache profile/subscription lookups per event) to blunt the
   latency without moving regions.

Until one of those is chosen, `asia-southeast1` is the supported home for the
Functions backend and the production LINE webhook target.
