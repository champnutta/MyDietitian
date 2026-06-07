# Function Parity Matrix

Production LINE OA must remain on GAS until every required behavior is marked `done` and tested against migrated data.

## Current Status

- GAS production: still authoritative.
- Firebase backend: migration/staging only.
- Firebase `lineWebhook`: verifies signature, logs events, and supports staging onboarding, manual profile setup, subscription gate, text/image food, exercise, coach/menu consultation, weight, contact-admin, subscription request, redeem-code, and admin approve/reject flows.
- Firestore: ready for migrated data.
- Data migration: deferred until final production cutover.

## Critical LINE Behaviors

| GAS function area | Purpose | Firebase status |
| --- | --- | --- |
| `doPost` | LINE event entry point and routing | partial |
| `isDuplicate` | Prevent duplicate LINE message processing | partial staging text dedupe |
| `handleFollowEvent` | Follow/onboarding | partial Firestore staging |
| `checkUserStatus` | User registration state | partial Firestore profile readiness |
| `checkSubscription` | Subscription gate | partial Firestore staging gate for food/image/exercise |
| `handleTextMessage` | Main text command and chat flow | partial staging food text plus help/profile/dashboard/summary/weight/undo/setup/subscription/coach/menu |
| `handleImageMessage` | LINE image message flow | partial Firestore staging with food/slip/BIA/other classification |
| `getLineContent` | Download LINE image/file content | partial image-only staging |
| `analyzeFoodImage` / food prompt | Image nutrition analysis | partial through `analyzeMeal` staging |
| `saveToSheetAndGetSummary` | Save meal and return daily summary | partial Firestore write and reply only |
| `replyToLine` / `pushMessage` | Reply and push messages | partial staging replies only |
| `showLoadingAnimation` | LINE loading UX | partial best-effort image flow |
| `handleFileMessage` | PDF/BIA/file routing | partial Firestore staging queue |
| `handleBIAReport` | Body composition report analysis | partial Firestore staging with AI analysis and target confirm |
| `handleExerciseLog` | Exercise logging | partial Firestore staging with `exerciseAnalysis` |
| `handleConsultation` / `handleMenuRecommendation` | AI coach Q&A and menu advice | partial Firestore staging with `coachConsultation` |
| `handleWeightLog` | Weight logging | partial Firestore staging |
| `handleUndo` / `deleteLastUserLog` | Undo/delete latest log | partial Firestore staging meal logs |
| `handleSubscriptionRequest` | Payment request flow | partial staging packages/QR response |
| `handleSlipPayment` | Slip parsing and admin review | partial Firestore staging pending-review flow |
| `handleAdminApprove` / `handleAdminReject` | Admin subscription approval | partial Firestore staging |
| `handleContactAdmin` | Customer to admin escalation | partial Firestore staging |
| Admin chat mode | Temporary admin-to-customer chat | partial Firestore staging |
| `handleRedeemCode` | Redeem subscription code | partial Firestore staging with `redeemCodes` |
| `notifyAdminError` | Error reporting | partial Firestore staging |

## Dashboard and Data Behaviors

| GAS function area | Purpose | Firebase status |
| --- | --- | --- |
| `getDashboardData` | Dashboard history API | not started |
| `processLogSheet` | Read main/archive log rows | import planned |
| `getUserProfile` | Profile and target lookup | partial |
| `getTodaySummary` | Today's nutrition summary | partial Firestore staging |
| `updateUserStreak` | Streak tracking | not started |
| `archiveOldLogs` | Move old rows into archive sheets | not needed after Firestore migration |
| `saveSettingsFromWeb` | LIFF settings save | partial through `updateProfile`; LINE quick setup added for staging |

## Cutover Rule

Do not move the LINE OA production webhook to Firebase until:

- Sheet data migration has completed and has been verified.
- Dashboard/history APIs read from Firestore correctly.
- LINE text/image flows reply to users correctly.
- Admin/payment/subscription flows have parity or approved replacement behavior.
- A staging LINE OA or test channel has passed end-to-end tests.
