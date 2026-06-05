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

- Git repo exists locally, but no remote is configured yet.
- Firebase CLI is installed, but the current login needs re-authentication before project linking.
- Flutter is not installed on this machine, so the initial scaffold uses Expo / React Native for faster local startup.

## Immediate next steps

1. Re-authenticate Firebase CLI and create/link a Firebase project.
2. Install project dependencies.
3. Start moving core webhook and Gemini logic from GAS into Firebase Functions.
4. Build the first mobile flow: auth, chat input, image upload, and analysis result.

