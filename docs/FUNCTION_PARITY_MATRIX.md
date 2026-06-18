# Function Parity Matrix

Production LINE OA must remain on GAS until every required behavior is marked `done` and tested against migrated data.

## Current Status

- GAS production: still authoritative.
- Firebase backend: migration/staging only.
- Firebase `lineWebhook`: verifies signature, logs events, and supports staging onboarding, manual profile setup, subscription gate, text/image food, latest-meal correction/portion adjustment, leftover image subtraction, exercise, coach/menu consultation, weight, contact-admin, subscription request, payment slip review, BIA image/PDF/file review, redeem-code, and admin approve/reject flows.
- Firestore: ready for migrated data.
- Data migration: deferred until final production cutover.

## Critical LINE Behaviors

| GAS function area | Purpose | Firebase status |
| --- | --- | --- |
| `doPost` | LINE event entry point and routing | staging implemented; pending real LINE UAT |
| `isDuplicate` | Prevent duplicate LINE message processing | staging implemented with `lineEventDedup`; pending real LINE UAT |
| `handleFollowEvent` | Follow/onboarding | staging implemented; pending real LINE/LIFF UAT |
| `checkUserStatus` | User registration state | staging implemented with Firestore profile readiness; pending migrated-data verification |
| `checkSubscription` | Subscription gate | staging implemented for text/image/file/exercise/coach flows; pending real LINE UAT |
| `handleTextMessage` | Main text command and chat flow | staging implemented for food/help/profile/dashboard/summary/weight/undo/correction/portion/setup/subscription/coach/menu |
| `handleImageMessage` | LINE image message flow | staging implemented with food/slip/BIA/leftover/other classification; pending real LINE media UAT |
| `getLineContent` | Download LINE image/file content | staging implemented for image and file content; pending real LINE media/file UAT |
| `analyzeFoodImage` / food prompt | Image nutrition analysis | staging implemented through `analyzeMeal`; pending real food-image UAT |
| `saveToSheetAndGetSummary` | Save meal and return daily summary | replaced by Firestore write/reply; pending migrated-data dashboard parity |
| `replyToLine` / `pushMessage` | Reply and push messages | staging implemented; pending real LINE UAT |
| `showLoadingAnimation` | LINE loading UX | staging implemented best-effort for longer media flows |
| `handleFileMessage` | PDF/BIA/file routing | staging implemented for PDF/image BIA files; pending real BIA file UAT |
| `handleBIAReport` | Body composition report analysis | staging implemented with AI analysis and target confirm; pending real BIA UAT |
| `handleExerciseLog` | Exercise logging | staging implemented with `exerciseAnalysis` plus rule fallback |
| `handleConsultation` / `handleMenuRecommendation` | AI coach Q&A and menu advice | staging implemented with `coachConsultation` |
| `handleWeightLog` | Weight logging | staging implemented |
| `handleUndo` / `deleteLastUserLog` | Undo/delete latest log | staging implemented for Firestore meal logs |
| `handlePortionAdjustment` | Scale latest meal when user ate less | staging implemented with contract coverage for `2/3`, `2 ใน 3`, half, quarter, and percent |
| `handleLeftoverSubtraction` | Subtract visible leftovers from latest meal | staging implemented; pending real leftover-image UAT |
| AI router correction | Replace latest meal when user corrects text | staging implemented |
| `handleSubscriptionRequest` | Payment request flow | staging implemented with configurable plans/QR |
| `handleSlipPayment` | Slip parsing and admin review | staging implemented with pending `paymentReviews`; pending real slip UAT |
| `handleAdminApprove` / `handleAdminReject` | Admin subscription approval | staging implemented; pending real admin UAT |
| `handleContactAdmin` | Customer to admin escalation | staging implemented |
| Admin chat mode | Temporary admin-to-customer chat | staging implemented |
| `handleRedeemCode` | Redeem subscription code | staging implemented with Firestore `redeemCodes` |
| `notifyAdminError` | Error reporting | staging implemented through admin push best-effort |

## Dashboard and Data Behaviors

| GAS function area | Purpose | Firebase status |
| --- | --- | --- |
| `getDashboardData` | Dashboard history API | staging implemented with aggregate series and detailed meal/exercise/weight history; pending post-import parity |
| `processLogSheet` | Read main/archive log rows | replaced by Firestore range queries after migration |
| `getUserProfile` | Profile and target lookup | staging implemented through Firestore `profiles`/`users` reads |
| `getTodaySummary` | Today's nutrition summary | staging implemented through Firestore daily summary |
| `updateUserStreak` | Streak tracking | staging implemented via `profiles.streak` after meal logs |
| `archiveOldLogs` | Move old rows into archive sheets | not needed after Firestore migration |
| `saveSettingsFromWeb` | LIFF settings save | staging implemented with auto/custom target calculation, optional identity verification, trial grant, and weight log; pending real LIFF token UAT |

## Cutover Rule

Do not move the LINE OA production webhook to Firebase until:

- Sheet data migration has completed and has been verified.
- Dashboard/history APIs read from Firestore correctly.
- LINE text/image flows reply to users correctly.
- Admin/payment/subscription flows have parity or approved replacement behavior.
- A staging LINE OA or test channel has passed end-to-end tests.
