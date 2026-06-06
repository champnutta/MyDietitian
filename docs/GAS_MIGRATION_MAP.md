# GAS Migration Map

## Current legacy areas found in `GAS data/Code.gs`

- LINE webhook handling in `doPost`
- LIFF and dashboard handling in `doGet`
- Gemini text and image calls in `callGemini`
- Spreadsheet-based user, meal, and weight storage
- Admin commands and subscription logic

## Recommended migration order

### 1. High priority

- `callGemini`
  - Moved into `analyzeMeal` for text and inline image analysis
- `getDashboardData`
  - Rebuild on Firestore queries
- `updateUserProfileFromLIFF`
  - Replace with authenticated profile endpoint

### 2. Medium priority

- `handleTextMessage`
- `handleImageMessage`
- `saveWeightToSheet`
- `checkUserStatus`
- `getUserProfile`

### 3. Later

- Admin chat mode
- Code redemption
- Legacy flex message helpers
- Spreadsheet archive logic

## Security fix required before broad rollout

The current LIFF/web flow relies on `uid` from URL state. The new system must derive user identity from authenticated tokens instead of trusting a user ID passed from the client.

## Production LINE OA status

Do not move the production LINE OA webhook to Firebase yet. The Firebase `lineWebhook` currently verifies signatures, logs events, and supports limited staging text food replies only. It does not yet implement the full GAS `doPost` behavior, image download, subscription checks, admin/payment flows, or full LINE reply parity.
