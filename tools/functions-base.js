"use strict";

// Single source of truth for the deployed Cloud Functions base URL used by the
// local tooling. Region is centralized here so a region move only touches one
// file. Override with env vars during a transition window, e.g. to point tools
// back at the previous region while the new region is being verified:
//
//   set MD_FUNCTIONS_BASE=https://asia-southeast1-mydietitian.cloudfunctions.net
//
// or override the pieces:
//
//   set MD_FUNCTIONS_REGION=asia-southeast1

const PROJECT_ID = process.env.MD_PROJECT_ID || "mydietitian";
const REGION = process.env.MD_FUNCTIONS_REGION || "asia-southeast3";
const FUNCTIONS_BASE =
  process.env.MD_FUNCTIONS_BASE || `https://${REGION}-${PROJECT_ID}.cloudfunctions.net`;

function functionUrl(name) {
  return `${FUNCTIONS_BASE}/${name}`;
}

module.exports = { PROJECT_ID, REGION, FUNCTIONS_BASE, functionUrl };
