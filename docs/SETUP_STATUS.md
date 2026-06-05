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
- Health endpoint verified:
  - `https://asia-southeast1-mydietitian.cloudfunctions.net/health`
- The failed leftover `health(us-central1)` function from the first deployment attempt was deleted.

## Local tooling

- Node.js available
- npm available
- Firebase CLI available
- Flutter not installed on this machine

## Decision taken

Use Expo / React Native for the initial mobile scaffold so development can begin immediately without waiting for Flutter installation.
