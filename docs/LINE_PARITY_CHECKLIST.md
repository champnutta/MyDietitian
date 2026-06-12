# LINE OA Parity Checklist

The Firebase `lineWebhook` must not replace the production GAS webhook until this checklist is complete.

## Required before production switch

- Verify LINE signature.
- Deduplicate message events. Done for staging text messages.
- Handle `follow` events. Partial: staging creates/updates LINE user links, stores display name for incomplete profiles, and replies with onboarding/subscription guidance.
- Handle new user onboarding. Partial: staging uses a LINE Flex onboarding card with LIFF link, Firebase Hosting has a replacement settings form at `https://mydietitian.web.app/settings`, and quick manual setup works via `ตั้งค่า ชื่อ 2000 40-30-30`. The LIFF app endpoint still needs to be pointed to the hosted page in LINE Console and verified from a real LINE chat.
- Check user subscription status. Partial: staging gates LINE food/image/exercise analysis when profile is incomplete or subscription is expired.
- Route text commands. Partial: staging supports help, profile/status, dashboard link, daily summary, weight log, undo latest meal, latest-meal correction, portion adjustment, quick setup, subscription, redeem code, contact admin, exercise logs, coach consultation, and menu recommendations.
- Route image messages. Partial: staging classifies LINE images as food/slip/BIA/leftover/other, supports food/slip/leftover routes, and queues BIA reports.
- Download LINE image content. Partial: staging downloads image content in memory only.
- Analyze food images and leftovers. Partial: staging sends LINE food images to the configured meal analysis agent and can subtract visible leftover nutrients from the latest Firestore meal log.
- Save meal logs. Done for staging text and image food messages.
- Send LINE replies. Done for staging text/image food messages and unsupported-message notices.
- Send loading animation where supported. Partial: staging starts best-effort LINE loading animation for image analysis.
- Handle file uploads and BIA reports. Partial: staging accepts BIA image/PDF files, creates `biaReports`, runs `biaAnalysis`, saves weight metrics when available, and supports target-confirm commands; signed LINE file/image tests are still pending.
- Handle exercise logs. Partial: staging detects exercise text, estimates burn with `exerciseAnalysis`, falls back to a conservative rule-based estimate if the AI call fails, applies 50% safety factor, and writes Firestore `exerciseLogs`.
- Handle weight logs. Partial: staging manual LINE text weight logging writes to Firestore.
- Handle undo/delete/correct latest meal. Partial: staging deletes latest Firestore meal log, replaces latest meal for correction text, and scales latest meal nutrients for portion adjustment including fractions/percentages such as `กิน 2/3`, `เหลือ 1/4`, and `กินไป 70%`.
- Handle subscription request flow. Partial: staging replies with the legacy packages and QR URL, and writes `subscriptionRequests`.
- Handle slip/payment review. Partial: staging detects slip images, creates pending `paymentReviews`, notifies admin, and lets admin approve/reject through existing commands.
- Handle admin approve/reject. Partial: staging supports admin `อนุมัติ {LINE_USER_ID|canonicalId} {days}` / `approve ...` and `ปฏิเสธ ...` / `reject ...`, writes `paymentReviews` and `subscriptionEvents`, and updates Firestore subscription expiry.
- Handle admin chat mode. Partial: staging supports admin `คุย {LINE_USER_ID}` and `จบ` with 30-minute Firestore session.
- Handle contact-admin flow. Partial: staging forwards `ติดต่อ/แอดมิน/admin ...` messages to admin LINE and stores `adminContactRequests`.
- Log errors and notify admin. Partial: staging writes event errors to `adminAuditLogs` and best-effort pushes admin LINE notification.

## Current Firebase status

- Signature verification: done.
- Event logging: done.
- Text and image food analysis/reply: staging only.
- Signed LINE webhook test: pending.
- Signed LINE text test tooling: local script added in `tools/signed_line_webhook_test.js`; media flows still require real LINE image/file messages.
- Known legacy command guard: quick setup, subscription request, redeem code, contact-admin, menu recommendation, coach consultation, payment-slip queue, BIA analysis/confirm, and admin approve/reject now have partial staging handlers.
- Text command parity: help, profile/status, dashboard link, daily summary, manual weight log, undo latest meal, latest-meal correction, and portion adjustment are implemented for Firestore staging data.
- Onboarding/subscription gate parity: staging blocks food/image/exercise analysis until the LINE user has target macros and an active subscription/trial in Firestore.
- Exercise parity: staging supports exercise guide and exercise text logs such as running/walking/weight training with measurable duration or distance.
- Coach/menu parity: staging routes menu/advice questions to `aiAgents/coachConsultation`, uses today's Firestore summary and recent meals, stores `coachConsultations`, and does not create meal logs for advice-only text. Signed LINE text test is still pending.
- Image food parity: staging downloads LINE image content, analyzes it with `aiAgents/mealAnalysis`, saves a Firestore meal log, and replies with the meal summary. Signed LINE image test is still pending.
- Leftover image parity: staging classifies leftover images, estimates visible leftover nutrients with `aiAgents/mealAnalysis`, stores a `leftover-subtraction` adjustment, and updates the latest Firestore meal log. Signed LINE leftover image test is still pending.
- Contact/admin chat parity: staging forwards customer contact messages to admin, supports temporary admin chat mode, and logs chat messages in Firestore.
- Subscription parity: staging can show packages/QR, redeem migrated codes from `redeemCodes`, classify slip images, create pending payment reviews, and let admin approve/reject subscriptions. Automatic bank verification is still pending.
- Error reporting: staging logs failed LINE event processing and best-effort notifies the configured admin LINE user.
- LIFF settings replacement: hosted page deployed, CORS verified, pending real LIFF `authVerified: true` test from LINE.
- Dashboard endpoint: staging endpoint deployed, pending migrated production data verification.
- Full production customer replies: not done.
- Production replacement: not ready.
