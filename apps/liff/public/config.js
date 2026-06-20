// Shared runtime config for the LIFF static pages.
// Centralizes the Cloud Functions base URL so a region move only touches this
// one file instead of every HTML page. Keep the region here in sync with
// services/backend/src/runtime.ts and deploy hosting + functions together so the
// pages never point at a region that has not been deployed yet.
window.MD_FUNCTIONS_BASE = "https://asia-southeast3-mydietitian.cloudfunctions.net";
