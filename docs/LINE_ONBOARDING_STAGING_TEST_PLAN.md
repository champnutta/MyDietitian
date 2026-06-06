# LINE Onboarding Staging Test Plan

Production LINE OA must stay on GAS while this plan is tested on a staging LINE OA or test channel.

## Preconditions

- Staging LINE OA webhook points to Firebase `lineWebhook`.
- Firebase secrets are configured: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `ADMIN_LINE_USER_ID`, `GEMINI_API_KEY`.
- Firestore is in project `mydietitian`.
- Do not run final Google Sheet migration for this test.

## Test Cases

### 1. New user follow

Expected:
- Firebase creates or updates `lineLinks/{lineUserId}`.
- Firebase creates or updates `users/{canonicalUserId}` with `status: needs_profile`.
- Firebase creates or updates `profiles/{canonicalUserId}` with `lineUserId` and display name.
- LINE replies with the Flex onboarding card.

### 2. New user sends food before setup

Message example:

```text
ข้าวมันไก่ 1 จาน
```

Expected:
- No `mealLogs` document is created.
- LINE replies with the onboarding card.
- Webhook result status should be `profile-required-before-meal`.

### 3. Quick manual setup

Message example:

```text
ตั้งค่า แชมป์ 2000 40-30-30
```

Expected:
- `profiles/{canonicalUserId}.target` is saved with calories and macro grams.
- `subscriptions/{canonicalUserId}` is created with a 3-day trial if no previous expiry exists.
- `profileEvents` receives a `manual-line-setup` event.
- LINE confirms the saved target and expiry date.

### 4. Food after setup

Message example:

```text
ไข่ต้ม 2 ฟอง
```

Expected:
- AI uses `aiAgents/mealAnalysis`.
- `mealLogs` and `aiRuns` are created.
- LINE replies with meal analysis.

### 5. Re-follow existing configured user

Expected:
- Existing custom profile display name is not overwritten by LINE display name.
- If subscription is active, LINE replies with a ready message.
- If subscription is expired, LINE replies with subscription package guidance.

## Still Pending After This Plan

- Slip image classification and payment review.
- BIA/PDF/file handling.
- Production data migration and dashboard verification.
- Production webhook cutover and rollback rehearsal.
