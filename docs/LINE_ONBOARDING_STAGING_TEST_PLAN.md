# LINE Onboarding Staging Test Plan

Production LINE OA must stay on GAS while this plan is tested on a staging LINE OA or test channel.

## Preconditions

- Staging LINE OA webhook points to Firebase `lineWebhook`.
- Firebase secrets are configured: `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `ADMIN_LINE_USER_ID`, `GEMINI_API_KEY`.
- Firestore is in project `mydietitian`.
- Do not run final Google Sheet migration for this test.

## Signed Webhook Test Tool

Use the local script to send signed LINE-style webhook events to Firebase staging without changing the production LINE OA webhook.

Generate the full dry-run UAT matrix first:

```powershell
npm run line:uat-report
```

Optional Markdown report:

```powershell
npm run line:uat-report -- --out docs/LINE_STAGING_UAT_REPORT.md
```

PowerShell example:

```powershell
$env:LINE_CHANNEL_SECRET="your-staging-channel-secret"
npm run test:line-webhook -- --scenario follow --user U_STAGING_TEST_USER
npm run test:line-webhook -- --scenario setup --user U_STAGING_TEST_USER --text "ตั้งค่า Test 2000 40-30-30"
npm run test:line-webhook -- --scenario food --user U_STAGING_TEST_USER --text "ไข่ต้ม 2 ฟอง"
```

Dry run without sending:

```powershell
npm run test:line-webhook -- --scenario food --dry-run
```

Supported scenarios:

`follow`, `setup`, `food`, `exercise`, `menu`, `portion`, `correction`, `dashboard`, `summary`, `weight`, `subscribe`, `contact`, `text`.

Image/file flows still require a real LINE message because Firebase must download media from LINE using a real `messageId`.

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

### 6. Manual exercise

Message example:

```text
วิ่ง 30 นาที
```

Expected:

- AI uses `aiAgents/exerciseAnalysis`.
- `exerciseLogs` is created with the legacy 50% safety factor applied.
- Daily summary and dashboard burn totals include the exercise.

### 7. Portion adjustment

Message examples:

```text
กินครึ่งเดียว
กิน 1/4
กิน 2/3
```

Expected:

- Latest meal is adjusted by the requested ratio.
- `mealAdjustments` is created.
- Dashboard totals reflect the adjusted meal values.

### 8. Dashboard link

Message examples:

```text
กราฟ
dashboard
```

Expected:

- LINE replies with the current configured dashboard bridge.
- During staging, this should remain the GAS dashboard until migrated Firestore data is verified.

## Real LINE Media UAT Required

These cases cannot be fully tested with fake local message IDs:

- Food image analysis.
- Leftover image subtraction.
- Payment slip image review.
- BIA image or file analysis.

Run these on a staging LINE OA after Firebase secrets are configured and before production cutover.

Record real LINE evidence in:

```text
docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md
```

## Still Pending After This Plan

- Signed image tests for food, leftover, slip, BIA, and files.
- Production data migration and dashboard verification.
- Production webhook cutover and rollback rehearsal.
