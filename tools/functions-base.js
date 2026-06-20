"use strict";

// Single source of truth for the deployed Cloud Functions base URL used by the
// local tooling. Region is centralized here so a future region move only touches
// one file. Functions run in asia-southeast1 because Cloud Functions v2 does not
// offer asia-southeast3 (Bangkok) yet, even though Firestore lives there; see
// docs/REGION_MIGRATION_RUNBOOK.md. Override with env vars if needed:
//
//   set MD_FUNCTIONS_BASE=https://asia-southeast2-mydietitian.cloudfunctions.net
//
// or override the pieces:
//
//   set MD_FUNCTIONS_REGION=asia-southeast2

const PROJECT_ID = process.env.MD_PROJECT_ID || "mydietitian";
const REGION = process.env.MD_FUNCTIONS_REGION || "asia-southeast1";
const FUNCTIONS_BASE =
  process.env.MD_FUNCTIONS_BASE || `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

function functionUrl(name) {
  return `${FUNCTIONS_BASE}/${name}`;
}

module.exports = { PROJECT_ID, REGION, FUNCTIONS_BASE, functionUrl };
