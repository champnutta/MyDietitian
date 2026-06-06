# LINE OA Parity Checklist

The Firebase `lineWebhook` must not replace the production GAS webhook until this checklist is complete.

## Required before production switch

- Verify LINE signature.
- Deduplicate message events. Done for staging text messages.
- Handle `follow` events.
- Handle new user onboarding.
- Check user subscription status.
- Route text commands. Partial: staging supports help, profile/status, dashboard link, daily summary, weight log, and undo latest meal.
- Route image messages. Partial: staging supports LINE image food messages.
- Download LINE image content. Partial: staging downloads image content in memory only.
- Analyze food images. Partial: staging sends LINE images to the configured meal analysis agent.
- Save meal logs. Done for staging text and image food messages.
- Send LINE replies. Done for staging text/image food messages and unsupported-message notices.
- Send loading animation where supported. Partial: staging starts best-effort LINE loading animation for image analysis.
- Handle file uploads and BIA reports.
- Handle exercise logs. Partial: staging detects exercise text, estimates burn with `exerciseAnalysis`, falls back to a conservative rule-based estimate if the AI call fails, applies 50% safety factor, and writes Firestore `exerciseLogs`.
- Handle weight logs. Partial: staging manual LINE text weight logging writes to Firestore.
- Handle undo/delete last meal. Partial: staging deletes latest Firestore meal log.
- Handle subscription request flow. Partial: staging replies with the legacy packages and QR URL, and writes `subscriptionRequests`.
- Handle slip/payment review.
- Handle admin approve/reject. Partial: staging supports admin `อนุมัติ {LINE_USER_ID|canonicalId} {days}` / `approve ...` and `ปฏิเสธ ...` / `reject ...`, writes `paymentReviews` and `subscriptionEvents`, and updates Firestore subscription expiry.
- Handle admin chat mode. Partial: staging supports admin `คุย {LINE_USER_ID}` and `จบ` with 30-minute Firestore session.
- Handle contact-admin flow. Partial: staging forwards `ติดต่อ/แอดมิน/admin ...` messages to admin LINE and stores `adminContactRequests`.
- Log errors and notify admin. Partial: staging writes event errors to `adminAuditLogs` and best-effort pushes admin LINE notification.

## Current Firebase status

- Signature verification: done.
- Event logging: done.
- Text and image food analysis/reply: staging only.
- Signed LINE webhook test: pending.
- Known legacy command guard: settings/menu-recommendation/payment-slip/BIA commands still show a staging notice. Subscription request, redeem code, contact-admin, and admin approve/reject now have partial staging handlers.
- Text command parity: help, profile/status, dashboard link, daily summary, manual weight log, and undo latest meal are implemented for Firestore staging data.
- Exercise parity: staging supports exercise guide and exercise text logs such as running/walking/weight training with measurable duration or distance.
- Image food parity: staging downloads LINE image content, analyzes it with `aiAgents/mealAnalysis`, saves a Firestore meal log, and replies with the meal summary. Signed LINE image test is still pending.
- Contact/admin chat parity: staging forwards customer contact messages to admin, supports temporary admin chat mode, and logs chat messages in Firestore.
- Subscription parity: staging can show packages/QR, redeem migrated codes from `redeemCodes`, and let admin approve/reject subscriptions. Slip image classification and automatic slip review are still pending.
- Error reporting: staging logs failed LINE event processing and best-effort notifies the configured admin LINE user.
- Dashboard endpoint: staging endpoint deployed, pending migrated production data verification.
- Full production customer replies: not done.
- Production replacement: not ready.
