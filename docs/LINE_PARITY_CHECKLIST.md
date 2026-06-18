# LINE OA Parity Checklist

The Firebase `lineWebhook` must not replace the production GAS webhook until this checklist is complete. Production users should keep using the current GAS + Google Sheet system until final data migration and dashboard parity are verified.

## Current Boundary

- GAS production is still authoritative.
- Firebase `lineWebhook` is staging/pre-production only.
- Google Sheet data migration is intentionally deferred until the final approved migration window.
- The hosted Firestore dashboard must remain a preview until migrated data is verified against the current GAS dashboard.
- AI provider config is controlled by Firestore `aiAgents/{agentId}` and currently uses Gemini `gemini-3.5-flash` primary with Anthropic `claude-sonnet-4-6` fallback.
- Both `GEMINI_API_KEY` and `ANTHROPIC_API_KEY` must exist in the correct Firebase/GCP project: `mydietitian`.

## Implemented For Staging

- LINE signature verification.
- Event logging and deduplication.
- Follow/onboarding flow with LINE-linked user creation/update.
- Manual quick setup from LINE text and hosted LIFF settings replacement.
- Profile/subscription gate before food, image, and exercise analysis.
- Text command routing for help, profile/status, dashboard link, daily summary, weight log, undo latest meal, corrections, portion adjustments, setup, subscription, redeem code, contact admin, exercise, coach, and menu requests.
- Food image handling through in-memory LINE content download, `aiAgents/mealAnalysis`, Firestore `mealLogs`, and LINE replies.
- Leftover image handling that subtracts visible leftover nutrients from the latest Firestore meal log.
- Exercise analysis through `aiAgents/exerciseAnalysis` with conservative rule-based fallback and the legacy 50% safety factor.
- BIA image/PDF/file staging flow through `biaReports`, `aiAgents/biaAnalysis`, and target confirmation.
- Payment slip staging flow with `paymentReviews`, admin notification, and admin approve/reject commands.
- Subscription plans, migrated redeem codes, admin day/plan approval, and lifetime/free entitlements.
- Coach/menu consultation through `aiAgents/coachConsultation` without creating meal logs.
- Contact-admin forwarding and temporary admin chat sessions.
- Error logging to `adminAuditLogs` with best-effort admin notification.
- Hosted Firestore dashboard preview at `https://mydietitian.web.app/dashboard?uid={LINE_USER_ID}`.

## Required Before Final Data Migration

- Real staging LINE food image UAT passes.
- Real staging LINE leftover image UAT passes.
- Real staging LINE payment slip UAT passes.
- Real staging LINE BIA image/PDF/file UAT passes.
- Real staging LINE exercise text UAT passes.
- Real staging LINE coach/menu text UAT passes.
- Real LIFF settings page opens inside LINE.
- Real LIFF identity/auth verification passes, or the risk is explicitly accepted for the migration window.
- Rollback values are recorded: current GAS webhook URL, Firebase webhook URL, LINE channel, operator, latest commit SHA, and Google Sheet fingerprint.
- `npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md --phase pre-migration` passes.

## Required After Data Migration And Before Production Webhook Switch

- Final migration import is verified with `npm run migration:verify-import`.
- Dashboard parity is verified for sampled users and date windows.
- Firestore dashboard links are confirmed against migrated data.
- Final cutover evidence passes with `npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md --phase cutover --parity-plan-json docs/DASHBOARD_PARITY_PLAN_OUTPUT.json`.
- Owner explicitly approves the production LINE webhook switch.

## Cutover Rule

If there is any doubt, keep production on GAS. Firebase should become production only after real LINE/LIFF UAT, final Google Sheet migration, dashboard parity, rollback readiness, and owner approval all pass.
