# Setup Status

## GitHub

- Local git repo exists
- No remote configured yet
- No commits yet

## Firebase

- Firebase CLI is installed
- Logged in account detected: `znak.iiz@gmail.com`
- Firebase project created successfully:
  - Project name: `Mydietitian`
  - Project ID: `mydietitian`
- `.firebaserc` now points to `mydietitian`
- Firestore database created:
  - Database: `(default)`
  - Edition: `STANDARD`
  - Mode: `FIRESTORE_NATIVE`
  - Location: `asia-southeast3 (Bangkok)`
- Firestore rules and indexes deployed successfully
- Functions scaffold compiles locally
- Firebase Functions cannot be deployed to `asia-southeast3` through Firebase Functions in this project.
- Functions region is set to `asia-southeast1 (Singapore)` as the closest Firebase Functions region to Bangkok.
- Functions deployed successfully in `asia-southeast1`:
  - `health`
  - `updateProfile`
  - `analyzeMeal`
  - `lineWebhook`
- `analyzeMeal` model is set to `gemini-3-flash-preview` to match the GAS source.
- `lineWebhook` is a staging receiver only. It verifies signatures and logs events, but it does not reply to customers yet.
- Health endpoint verified:
  - `https://asia-southeast1-mydietitian.cloudfunctions.net/health`
- Secrets are configured and attached to Functions:
  - `GEMINI_API_KEY`
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `LINE_CHANNEL_SECRET`
  - `ADMIN_LINE_USER_ID`
- `analyzeMeal` was deployed with Gemini integration and successfully created test `aiRuns` and `mealLogs` records.
- Note: the first Windows PowerShell inline JSON test garbled Thai input text, so app/LINE clients should send UTF-8 JSON bodies.
- The failed leftover `health(us-central1)` function from the first deployment attempt was deleted.

## Local tooling

- Node.js available
- npm available
- Firebase CLI available
- Flutter not installed on this machine

## Decision taken

Use Expo / React Native for the initial mobile scaffold so development can begin immediately without waiting for Flutter installation.
