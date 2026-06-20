// Shared runtime config for the LIFF static pages.
// Centralizes the Cloud Functions base URL so a future region move only touches
// this one file instead of every HTML page. Keep the region here in sync with
// services/backend/src/runtime.ts. Functions are in asia-southeast1 because
// Cloud Functions v2 does not offer asia-southeast3 (Bangkok) yet; see
// docs/REGION_MIGRATION_RUNBOOK.md.
window.MD_FUNCTIONS_BASE = "https://asia-southeast1-mydietitian.cloudfunctions.net";
