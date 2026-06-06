# LINE OA Parity Checklist

The Firebase `lineWebhook` must not replace the production GAS webhook until this checklist is complete.

## Required before production switch

- Verify LINE signature.
- Deduplicate message events. Done for staging text messages.
- Handle `follow` events.
- Handle new user onboarding.
- Check user subscription status.
- Route text commands. Partial: known legacy commands are deferred to GAS with a staging notice.
- Route image messages.
- Download LINE image content.
- Analyze food images.
- Save meal logs. Done for staging text food messages.
- Send LINE replies. Done for staging text food messages and unsupported-message notices.
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
- Text food analysis and reply: staging only.
- Signed LINE webhook test: pending.
- Known legacy command guard: staging notice only.
- Dashboard endpoint: staging endpoint deployed, pending migrated production data verification.
- Full production customer replies: not done.
- Production replacement: not ready.
