# LINE OA Parity Checklist

The Firebase `lineWebhook` must not replace the production GAS webhook until this checklist is complete.

## Required before production switch

- Verify LINE signature.
- Deduplicate message events. Done for staging text messages.
- Handle `follow` events.
- Handle new user onboarding.
- Check user subscription status.
- Route text commands. Partial: staging supports help, profile/status, dashboard link, daily summary, weight log, and undo latest meal.
- Route image messages.
- Download LINE image content.
- Analyze food images.
- Save meal logs. Done for staging text food messages.
- Send LINE replies. Done for staging text food messages and unsupported-message notices.
- Send loading animation where supported.
- Handle file uploads and BIA reports.
- Handle exercise logs.
- Handle weight logs. Partial: staging manual LINE text weight logging writes to Firestore.
- Handle undo/delete last meal. Partial: staging deletes latest Firestore meal log.
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
- Known legacy command guard: subscription/admin/code/contact/settings/payment commands still show a staging notice.
- Text command parity: help, profile/status, dashboard link, daily summary, manual weight log, and undo latest meal are implemented for Firestore staging data.
- Dashboard endpoint: staging endpoint deployed, pending migrated production data verification.
- Full production customer replies: not done.
- Production replacement: not ready.
