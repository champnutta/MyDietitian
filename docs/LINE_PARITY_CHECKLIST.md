# LINE OA Parity Checklist

The Firebase `lineWebhook` must not replace the production GAS webhook until this checklist is complete.

## Required before production switch

- Verify LINE signature.
- Deduplicate message events.
- Handle `follow` events.
- Handle new user onboarding.
- Check user subscription status.
- Route text commands.
- Route image messages.
- Download LINE image content.
- Analyze food images.
- Save meal logs.
- Send LINE replies.
- Send loading animation where supported.
- Handle file uploads and BIA reports.
- Handle exercise logs.
- Handle weight logs.
- Handle undo/delete last meal.
- Handle subscription request flow.
- Handle slip/payment review.
- Handle admin approve/reject.
- Handle admin chat mode.
- Handle contact-admin flow.
- Log errors and notify admin.

## Current Firebase status

- Signature verification: done.
- Event logging: done.
- Dashboard endpoint: staging endpoint deployed, pending migrated production data verification.
- Customer replies: not done.
- Production replacement: not ready.
