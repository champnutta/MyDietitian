# Mydietitian

Fast-track migration workspace for moving the current Google Apps Script + Google Sheets + LINE OA nutrition coach into a mobile-first product with Firebase as the shared backend.

## Planned stack

- Mobile app: Expo / React Native
- Backend: Firebase Functions
- Database: Firestore
- Storage: Firebase Storage
- Notifications: Firebase Cloud Messaging
- Legacy bridge: LINE OA webhook integration

## Workspace layout

- `apps/mobile` - mobile app scaffold
- `services/backend` - Firebase Functions scaffold
- `docs` - architecture, migration, and execution notes
- `GAS data` - current legacy source snapshot

## Current status

- Git repo is connected to `https://github.com/champnutta/MyDietitian.git`.
- Firebase project `mydietitian` is linked.
- Firestore Standard edition is live in `asia-southeast3 (Bangkok)`.
- Firebase Functions are live in `asia-southeast1 (Singapore)`.
- Flutter is not installed on this machine, so the initial scaffold uses Expo / React Native for faster local startup.

## Deployed endpoints

- Health: `https://asia-southeast1-mydietitian.cloudfunctions.net/health`
- Update profile: `https://asia-southeast1-mydietitian.cloudfunctions.net/updateProfile`
- Analyze meal: `https://asia-southeast1-mydietitian.cloudfunctions.net/analyzeMeal`
- LINE webhook: `https://asia-southeast1-mydietitian.cloudfunctions.net/lineWebhook`

## Immediate next steps

1. Add environment secrets.
2. Start moving core webhook and Gemini logic from GAS into Firebase Functions.
3. Build the first mobile flow: auth, chat input, image upload, and analysis result.
4. Connect LINE OA webhook to the deployed backend endpoint.
