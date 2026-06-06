# Function Parity Matrix

Production LINE OA must remain on GAS until every required behavior is marked `done` and tested against migrated data.

## Current Status

- GAS production: still authoritative.
- Firebase backend: migration/staging only.
- Firebase `lineWebhook`: verifies signature, logs events, and supports limited staging text food replies only.
- Firestore: ready for migrated data.
- Data migration: deferred until final production cutover.

## Critical LINE Behaviors

| GAS function area | Purpose | Firebase status |
| --- | --- | --- |
| `doPost` | LINE event entry point and routing | partial |
| `isDuplicate` | Prevent duplicate LINE message processing | partial staging text dedupe |
| `handleFollowEvent` | Follow/onboarding | not started |
| `checkUserStatus` | User registration state | partial schema only |
| `checkSubscription` | Subscription gate | not started |
| `handleTextMessage` | Main text command and chat flow | partial staging food text plus help/profile/dashboard/summary/weight/undo |
| `handleImageMessage` | LINE image message flow | not started |
| `getLineContent` | Download LINE image/file content | not started |
| `analyzeFoodImage` / food prompt | Image nutrition analysis | partial through `analyzeMeal` only |
| `saveToSheetAndGetSummary` | Save meal and return daily summary | partial Firestore write only |
| `replyToLine` / `pushMessage` | Reply and push messages | partial staging replies only |
| `showLoadingAnimation` | LINE loading UX | not started |
| `handleFileMessage` | PDF/BIA/file routing | not started |
| `handleBIAReport` | Body composition report analysis | not started |
| `handleExerciseLog` | Exercise logging | not started |
| `handleWeightLog` | Weight logging | partial Firestore staging |
| `handleUndo` / `deleteLastUserLog` | Undo/delete latest log | partial Firestore staging meal logs |
| `handleSubscriptionRequest` | Payment request flow | not started |
| `handleSlipPayment` | Slip parsing and admin review | not started |
| `handleAdminApprove` / `handleAdminReject` | Admin subscription approval | not started |
| `handleContactAdmin` | Customer to admin escalation | not started |
| `notifyAdminError` | Error reporting | not started |

## Dashboard and Data Behaviors

| GAS function area | Purpose | Firebase status |
| --- | --- | --- |
| `getDashboardData` | Dashboard history API | not started |
| `processLogSheet` | Read main/archive log rows | import planned |
| `getUserProfile` | Profile and target lookup | partial |
| `getTodaySummary` | Today's nutrition summary | partial Firestore staging |
| `updateUserStreak` | Streak tracking | not started |
| `archiveOldLogs` | Move old rows into archive sheets | not needed after Firestore migration |
| `saveSettingsFromWeb` | LIFF settings save | partial through `updateProfile` only |

## Cutover Rule

Do not move the LINE OA production webhook to Firebase until:

- Sheet data migration has completed and has been verified.
- Dashboard/history APIs read from Firestore correctly.
- LINE text/image flows reply to users correctly.
- Admin/payment/subscription flows have parity or approved replacement behavior.
- A staging LINE OA or test channel has passed end-to-end tests.
