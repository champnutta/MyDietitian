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

Do not move the production LINE OA webhook to Firebase yet.

Current Firebase `lineWebhook` status:

- Verifies LINE signatures and deduplicates events.
- Supports staging onboarding, profile/status, dashboard link, food text/image, leftovers, correction/portion adjustment, exercise, coach/menu consultation, weight logging, contact-admin, subscription/redeem, payment slip review, BIA file/image flow, and admin approve/reject flows.
- Uses Firestore data and the configured AI agents with Gemini primary plus Claude fallback.

Remaining before production replacement:

- Real LINE media/file UAT must pass and be recorded in `docs/MANUAL_UAT_EVIDENCE.md`.
- Real LIFF auth UAT must pass.
- Final Google Sheet to Firestore migration must complete and verify.
- Dashboard parity against GAS must pass for sampled users/date ranges.
- Owner must approve the production webhook cutover with rollback values recorded.
