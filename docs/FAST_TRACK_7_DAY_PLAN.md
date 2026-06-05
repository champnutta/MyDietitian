# Fast-Track 7 Day Migration Plan

## Goal

Ship an internal MVP that runs on a real phone, uses Firebase as the shared backend, and preserves LINE OA as the transition channel.

## Day 1

- Create and link Firebase project
- Set up Firestore Standard edition in `asia-southeast3 (Bangkok)`, Storage, Functions
- Create repo structure and environment placeholders

## Day 2

- Define Firestore schema
- Implement backend health endpoint
- Add initial webhook endpoint contract

## Day 3

- Migrate Gemini text analysis flow from GAS to backend
- Add image upload and analysis pipeline contract

## Day 4

- Build first mobile screens
- Connect Firebase Auth
- Add submit text and image flow

## Day 5

- Save meal logs and fetch history
- Build a simple dashboard summary screen

## Day 6

- Connect LINE webhook to the same backend flow
- Verify that app and LINE write to the same records

## Day 7

- Add basic security rules
- Add logging and prompt version tracking
- Prepare internal test build checklist

## What this plan does not guarantee

- Public App Store launch
- Google Play production release
- Final subscription or payment automation
- Full policy and compliance hardening
