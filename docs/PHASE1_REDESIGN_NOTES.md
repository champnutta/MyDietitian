# Phase 1 Redesign Notes

These are recommended upgrades while migrating GAS to Firebase. They are not blockers for staging parity, but they will make the production system safer and easier to evolve.

## Split the backend modules

`services/backend/src/index.ts` is growing quickly. Split it into focused modules before adding payment/admin/BIA flows:

- `line-router`: signature verification, event dedupe, event routing, reply/push helpers.
- `meal-service`: meal analysis, meal logging, daily summary, undo.
- `ai-provider`: Gemini/Anthropic provider adapters behind one response contract.
- `subscription-service`: subscription checks, code redemption, slip review, admin approve/reject.
- `profile-service`: canonical user links, profile updates, native app account linking.

## Store image metadata, not raw images

The staging image flow intentionally analyzes LINE images in memory and stores only `line-message://{messageId}`. For production, prefer:

- Store customer images in Firebase Storage only when there is a clear product reason.
- Use short retention and lifecycle deletion for food images.
- Store AI outputs and audit metadata in Firestore.
- Avoid writing base64 image data to Firestore.

## Add canary controls

Before switching production LINE OA, add admin controls for:

- Percentage rollout by user or cohort.
- Agent/model override per user for testing.
- Fast rollback to GAS webhook.
- Error-rate dashboard for LINE events and AI calls.

## Move slow flows to async jobs

LINE reply tokens expire quickly. Food image analysis is acceptable for staging, but BIA/PDF/payment flows should use async processing:

- Reply immediately that the file was received.
- Process in a background task.
- Push the result to the user/admin when done.
