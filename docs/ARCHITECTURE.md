# Target Architecture

## Core idea

Keep `LINE OA` as the familiar user channel during migration, but move the real source of truth into Firebase so both LINE and the mobile app share the same backend.

## Components

- `apps/mobile`
  - React Native / Expo client
  - Login
  - Chat and image upload
  - History and dashboard
- `services/backend`
  - Region: `asia-southeast1 (Singapore)` for Firebase Functions
  - LINE webhook endpoint
  - AI orchestration endpoint for Gemini
  - Firestore read/write logic
  - Notification triggers
- `Firestore`
  - Region: `asia-southeast3 (Bangkok)`
  - Edition: `Standard`
  - Users
  - Profiles
  - Meal logs
  - Exercise logs
  - Weight logs
  - Subscriptions
  - Feedback
- `Cloud Storage`
  - Uploaded food images
  - Optional BIA report images
- `LINE OA`
  - Support, re-engagement, and transition channel

## Recommended collections

- `users/{canonicalUserId}`
- `profiles/{canonicalUserId}`
- `mealLogs/{mealLogId}`
- `exerciseLogs/{exerciseLogId}`
- `weightLogs/{weightLogId}`
- `subscriptions/{canonicalUserId}`
- `feedback/{feedbackId}`
- `aiRuns/{runId}`
- `lineLinks/{lineUserId}`
- `authLinks/{firebaseAuthUid}`
- `aiAgents/{agentId}`

## Migration principle

1. Move auth and data ownership into Firebase.
2. Move Gemini calls into backend-only code.
3. Keep GAS live only as a temporary bridge.
4. Retire spreadsheet-as-database gradually, not all at once.
