# Firestore Schema V1

This is the first-pass schema for migrating the current GAS + Google Sheets system into Firebase.

## Collections

### `appConfig/runtime`

Admin-managed runtime config used by Firebase Functions. The backend keeps safe defaults if this document is missing.

```json
{
  "legacyGasDashboardUrl": "https://script.google.com/macros/s/...",
  "liffSettingsUrl": "https://liff.line.me/...",
  "paymentQrImage": "https://...",
  "profileAuthMode": "optional",
  "productionLineWebhookReady": false,
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

Current uses:

- `paymentQrImage` appears in subscription/payment instructions.
- `liffSettingsUrl` is used in LINE onboarding buttons.
- `legacyGasDashboardUrl` is the temporary dashboard bridge until the Firestore dashboard replaces GAS.
- URL values must be HTTPS; invalid values fall back to the safe defaults.

### `migrationRuns/{importRunId}`

Audit manifest written during a controlled Google Sheet import. The import tool creates the manifest with `status=running` before batch writes, updates `writtenDocuments` during progress, then marks it `completed` or `failed`. Imported documents are stamped with matching `legacy.importRunId`, `legacy.sourceFingerprint`, `legacy.sourceSheetId`, `legacy.readinessPacketGeneratedAt`, and `legacy.migrationCommit`.

Security: admin-only read/write. End users should not access migration manifests directly.

```json
{
  "importRunId": "google_sheet_5b5b312473ef",
  "status": "completed",
  "projectId": "mydietitian",
  "sheetId": "1Yf1yxbBbV7S1nCCtxuSOC1YIdiirFbx3GKKLUv_AUPI",
  "sourceFingerprint": {
    "algorithm": "sha256",
    "value": "5b5b..."
  },
  "readinessPacketGeneratedAt": "timestamp",
  "migrationCommit": "git-sha",
  "countByCollection": {
    "users": 74,
    "mealLogs": 11035
  },
  "totalPlannedDocuments": 11622,
  "writtenDocuments": 11622,
  "startedAt": "timestamp",
  "completedAt": "timestamp",
  "importedAt": "timestamp"
}
```

### `users/{canonicalUserId}`

Top-level account document shared by LINE OA and native app users.

```json
{
  "userId": "canonical-user-id",
  "canonicalUserId": "canonical-user-id",
  "createdAt": "timestamp",
  "updatedAt": "timestamp",
  "roles": ["user"],
  "status": "active",
  "source": {
    "app": true,
    "line": true
  },
  "auth": {
    "verified": true,
    "provider": "firebase"
  }
}
```

### `profiles/{canonicalUserId}`

Health and target profile used by the AI coach.

```json
{
  "userId": "canonical-user-id",
  "canonicalUserId": "canonical-user-id",
  "displayName": "Champ",
  "lineUserId": "Uxxxxxxxx",
  "firebaseAuthUid": "firebase-auth-uid",
  "authVerified": true,
  "authProvider": "line",
  "gender": "male",
  "age": 30,
  "heightCm": 170,
  "weightKg": 72.4,
  "activityFactor": 1.55,
  "goalType": "fat_loss",
  "target": {
    "calories": 2100,
    "proteinG": 150,
    "carbsG": 220,
    "fatG": 60,
    "fiberG": 25
  },
  "subscription": {
    "status": "trial",
    "expiresAt": "timestamp"
  },
  "streak": {
    "count": 3,
    "lastMealLogDayKey": "2026-06-08",
    "updatedAt": "timestamp"
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `mealLogs/{mealLogId}`

Food analysis records created from text or image input.

Portion adjustment commands support common fractions and percentages such as `กินครึ่งเดียว`, `กิน 2/3`, `เหลือ 1/4`, `กินไป 70%`, and `only 40%`. Repeated adjustments are calculated from the first saved `previousNutrients` snapshot rather than compounding on already-adjusted nutrients.
Leftover image subtraction stores an additional `adjustments[]` entry with `type: "leftover-subtraction"` and subtracts the visible leftover nutrients from the latest meal.

```json
{
  "userId": "firebase-auth-uid",
  "canonicalUserId": "canonical-user-id",
  "source": "app",
  "inputType": "image",
  "imageUrl": "gs://...",
  "mealNameTh": "ข้าวมันไก่",
  "mealNameEn": "Hainanese chicken rice",
  "portionDescription": "1 plate",
  "nutrients": {
    "caloriesKcal": 620,
    "proteinG": 32,
    "carbsG": 70,
    "fatG": 18,
    "fiberG": 2.5,
    "sugarG": 6
  },
  "healthRating": {
    "score": 6,
    "commentTh": "โปรตีนโอเค แต่คาร์บและน้ำมันค่อนข้างสูง"
  },
  "ai": {
    "agentId": "mealAnalysis",
    "primaryProvider": "gemini",
    "primaryModel": "gemini-3.5-flash",
    "provider": "anthropic",
    "model": "claude-sonnet-4-6",
    "promptVersion": "meal-v1",
    "fallbackUsed": true
  },
  "adjustments": [
    {
      "type": "portion-ratio",
      "ratio": 0.5,
      "label": "50% (ครึ่งจาน)",
      "commandText": "กินครึ่งเดียว",
      "previousNutrients": {
        "caloriesKcal": 620,
        "proteinG": 32,
        "carbsG": 70,
        "fatG": 18,
        "fiberG": 2.5,
        "sugarG": 6
      },
      "adjustedAt": "timestamp"
    },
    {
      "type": "leftover-subtraction",
      "lineMessageId": "LINE_MESSAGE_ID",
      "leftoverNameTh": "ข้าวที่เหลือ",
      "portionDescription": "ข้าวเหลือประมาณ 2 ช้อนโต๊ะ",
      "subtractedNutrients": {
        "caloriesKcal": 50,
        "proteinG": 1,
        "carbsG": 11,
        "fatG": 0,
        "fiberG": 0.2,
        "sugarG": 0
      },
      "previousNutrients": {
        "caloriesKcal": 620,
        "proteinG": 32,
        "carbsG": 70,
        "fatG": 18,
        "fiberG": 2.5,
        "sugarG": 6
      },
      "aiRunId": "aiRuns-id",
      "adjustedAt": "timestamp"
    }
  ],
  "correction": {
    "type": "replace-latest",
    "originalMealLogId": "previous-meal-log-id",
    "originalMealNameTh": "ข้าวมันไก่",
    "originalCommandText": "ไม่ใช่ข้าวมันไก่ เป็นข้าวหมูแดง",
    "correctedText": "ข้าวหมูแดง",
    "correctedAt": "timestamp"
  },
  "loggedAt": "timestamp",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `exerciseLogs/{exerciseLogId}`

Exercise events and burn estimates.

### `weightLogs/{weightLogId}`

Weight and body composition history.

```json
{
  "userId": "firebase-auth-uid",
  "canonicalUserId": "canonical-user-id",
  "weightKg": 72.4,
  "bodyFatPct": 19.3,
  "muscleMassKg": 31.2,
  "deviceName": "Smart Scale",
  "loggedAt": "timestamp",
  "createdAt": "timestamp"
}
```

## Dashboard API Response

`getDashboardData` returns legacy-compatible chart arrays and detailed Firestore history in one response:

```json
{
  "labels": ["01/06"],
  "calories": [1800],
  "macros": { "p": [120], "c": [180], "f": [60], "fib": [25] },
  "bodyData": { "weight": [72.4], "fat": [19.3], "muscle": [31.2], "devices": ["Manual"] },
  "tdeeLine": [2100],
  "daily": [
    {
      "date": "2026-06-01",
      "calories": 1800,
      "burnedCalories": 100,
      "dynamicTargetCalories": 2100,
      "remainingCalories": 300
    }
  ],
  "history": {
    "meals": [{ "id": "mealLogId", "mealNameTh": "ข้าวมันไก่", "nutrients": {}, "adjustments": [] }],
    "exercises": [{ "id": "exerciseLogId", "activityName": "เดิน", "caloriesBurned": 35 }],
    "weights": [{ "id": "weightLogId", "weightKg": 72.4 }],
    "adjustments": [{ "mealLogId": "mealLogId", "type": "portion-ratio" }]
  }
}
```

## LIFF Settings API

`saveSettingsFromWeb` accepts the legacy LIFF form shape and writes Firestore profile/subscription/weight data.
The staging endpoint returns a success response but does not push a LINE message, so the LIFF UI should show the confirmation itself until authenticated LIFF/API auth is added.
The endpoint now rejects unsafe public IDs and out-of-range settings values, but it is still not production-authenticated. Before production cutover, the LIFF/native clients should send a verified LINE ID token or Firebase Auth ID token instead of trusting `userId` from the request body.

Validation guardrails:

- `userId`, `canonicalUserId`, `lineUserId`, and `firebaseAuthUid` must use safe ASCII ID characters and be 2-128 characters.
- Auto mode requires weight 25-300 kg, height 100-230 cm, age 10-100, activity 1.0-2.5, and goal -1000 to 1000 kcal.
- Custom mode requires TDEE 800-6000 kcal, macro percentages 1-80 each, macro total close to 100, and fiber 0-100 g.

Identity verification:

- Firebase/native clients can send `Authorization: Bearer <Firebase ID token>`.
- LIFF clients can send `X-Line-Id-Token: <LINE ID token>`. The backend falls back to channel ID `2009365288` from the current LIFF ID, and `LINE_CHANNEL_ID` can override it in the function environment.
- The current default `PROFILE_AUTH_MODE=optional` verifies tokens when provided but still allows the legacy staging LIFF body-only flow.
- Set `PROFILE_AUTH_MODE=required` only after the new LIFF/native clients reliably send verified tokens. In required mode, profile/settings writes without a valid token return `401 profile-auth-failed`.
- Verified writes store `authVerified`, `authProvider`, and a `profileAuthEvents` audit record.

Auto mode:

```json
{
  "userId": "Uxxxxxxxx",
  "lineUserId": "Uxxxxxxxx",
  "displayName": "Champ",
  "config": {
    "mode": "auto",
    "gender": "male",
    "age": 30,
    "height": 170,
    "weight": 72,
    "activity": 1.55,
    "goal": -300,
    "dietStyle": "highprotein"
  }
}
```

Custom mode:

```json
{
  "userId": "canonical-user-id",
  "config": {
    "mode": "custom",
    "tdee": 2000,
    "p": 40,
    "c": 30,
    "f": 30
  }
}
```

### `biaReports/{biaReportId}`

BIA/InBody/smart-scale/health report queue created from LINE image or file uploads.

Security: users may read their own reports through matching `userId` or `canonicalUserId`; writes are backend/admin only.

```json
{
  "biaReportId": "report-id",
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "displayName": "Member",
  "status": "pending-analysis",
  "source": "line-file",
  "lineMessageId": "LINE message id",
  "fileName": "inbody.pdf",
  "fileUrl": "line-message://...",
  "mimeType": "application/pdf",
  "imageType": "bia",
  "analysis": {
    "meta": { "date_str": "TODAY", "device_name": "InBody" },
    "metrics": {
      "weight_kg": 72.4,
      "muscle_kg": 31.2,
      "fat_pct": 19.3,
      "bmr": 1600,
      "visceral_lvl": 8
    },
    "recommendation": {
      "suggested_tdee": 2100,
      "suggested_p": 150,
      "suggested_c": 220,
      "suggested_f": 60,
      "goal_name": "Recomposition",
      "reason_th": "Thai explanation"
    },
    "workout_advice_th": "Thai advice"
  },
  "analyzedAt": "timestamp",
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `subscriptions/{canonicalUserId}`

Subscription and entitlement record managed by backend/admin flow.

```json
{
  "userId": "canonical-user-id",
  "canonicalUserId": "canonical-user-id",
  "status": "active",
  "entitlementType": "duration",
  "lifetime": false,
  "expiresAt": "timestamp",
  "lastApprovedDays": 30,
  "lastApprovedPlanId": "30d",
  "lastApprovedPlanLabel": "30 วัน",
  "lastApprovedPriceThb": 59,
  "lastApprovedBy": "admin-line-user-id",
  "lastApprovedAt": "timestamp",
  "lastRedeemedCode": "ABC123",
  "updatedAt": "timestamp"
}
```

Lifetime/free users:

```json
{
  "status": "active",
  "entitlementType": "lifetime",
  "lifetime": true,
  "expiresAt": null
}
```

Use lifetime entitlement for close friends/family/internal VIP users instead of setting an expiry date years in the future.

### `subscriptionPlans/{planId}`

Admin-managed packages and promotions. The backend falls back to `30d` and `90d` if this collection is empty.

```json
{
  "planId": "promo-14d",
  "labelTh": "โปรทดลอง 14 วัน",
  "days": 14,
  "priceThb": 29,
  "active": true,
  "visible": true,
  "sortOrder": 5,
  "promoTag": "launch"
}
```

Internal lifetime plan example:

```json
{
  "planId": "lifetime",
  "labelTh": "Lifetime / VIP",
  "days": null,
  "priceThb": null,
  "entitlementType": "lifetime",
  "active": true,
  "visible": false,
  "internalOnly": true
}
```

Admin commands:

- `approve Uxxxxxxxx 30` grants a custom 30-day duration.
- `approve Uxxxxxxxx 90d` grants the `subscriptionPlans/90d` plan.
- `approve Uxxxxxxxx lifetime` grants a non-expiring entitlement.

### `profileEvents/{eventId}`

Append-only profile setup/update events, including LINE quick setup during staging.

Security: users may read their own profile events; writes are backend/admin only.

```json
{
  "type": "manual-line-setup",
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "displayName": "Champ",
  "target": {
    "calories": 2000,
    "proteinPct": 40,
    "carbsPct": 30,
    "fatPct": 30,
    "proteinG": 200,
    "carbsG": 150,
    "fatG": 67,
    "fiberG": 25
  },
  "createdAt": "timestamp"
}
```

### `profileAuthEvents/{eventId}`

Append-only audit trail for verified profile/settings writes.

Security: users may read their own profile auth events; writes are backend/admin only.

```json
{
  "functionName": "saveSettingsFromWeb",
  "canonicalUserId": "canonical-user-id",
  "provider": "firebase",
  "subject": "firebase-auth-uid",
  "firebaseAuthUid": "firebase-auth-uid",
  "lineUserId": null,
  "createdAt": "timestamp"
}
```

### `subscriptionRequests/{requestId}`

Staging record created when a LINE user asks for `สมัคร` / `เติมวัน`.

Security: users may read their own subscription requests; writes are backend/admin only.

```json
{
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "displayName": "Member",
  "status": "payment-instructions-sent",
  "packages": [{ "days": 30, "priceThb": 59 }],
  "paymentQrImage": "https://...",
  "createdAt": "timestamp"
}
```

### `paymentReviews/{reviewId}`

Admin review/audit records for subscription approval or rejection.

Security: users may read their own payment reviews; writes are backend/admin only.

```json
{
  "paymentReviewId": "review-id",
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "displayName": "Member",
  "status": "pending-admin-review",
  "source": "line-image",
  "lineMessageId": "LINE message id",
  "imageUrl": "line-message://...",
  "mimeType": "image/jpeg",
  "slipData": {
    "amount": 59,
    "date": "string",
    "time": "string",
    "receiverName": "string",
    "bankFrom": "string",
    "bankTo": "string"
  },
  "days": 30,
  "expiresAt": "timestamp",
  "reviewedBy": "admin-line-user-id",
  "reviewedAt": "timestamp",
  "createdAt": "timestamp"
}
```

### `subscriptionEvents/{eventId}`

Append-only subscription audit trail for admin actions and code redemption.

Security: users may read their own subscription events; writes are backend/admin only.

```json
{
  "type": "admin-approve",
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "days": 30,
  "planId": "30d",
  "planLabel": "30 วัน",
  "priceThb": 59,
  "lifetime": false,
  "expiresAt": "timestamp",
  "createdAt": "timestamp"
}
```

### `redeemCodes/{code}`

Migrated subscription codes from the legacy `Codes` sheet.

Security: admin-only read/write. Users redeem codes through the backend so unused code inventory is not exposed to clients.

```json
{
  "code": "ABC123",
  "days": 30,
  "lifetime": false,
  "status": "available",
  "usedBy": null,
  "usedDate": null
}
```

Lifetime redeem codes can set `lifetime: true`, `entitlementType: "lifetime"`, `days: null`.

### `feedback/{feedbackId}`

User feedback on AI output.

### `aiRuns/{runId}`

Internal audit record of AI requests for observability and cost tracking.

### `lineLinks/{lineUserId}`

Maps LINE users to app users during the migration period.

```json
{
  "lineUserId": "Uxxxxxxxx",
  "canonicalUserId": "canonical-user-id",
  "linkedAt": "timestamp",
  "status": "linked"
}
```

### `authLinks/{firebaseAuthUid}`

Maps native app Firebase Auth users to the shared canonical user.

```json
{
  "firebaseAuthUid": "firebase-auth-uid",
  "canonicalUserId": "canonical-user-id",
  "linkedAt": "timestamp",
  "status": "linked"
}
```

### `aiAgents/{agentId}`

Admin-configurable AI agent settings. Backend reads this before calling the provider.

```json
{
  "agentId": "mealAnalysis",
  "provider": "gemini",
  "model": "gemini-3.5-flash",
  "promptVersion": "meal-v1",
  "temperature": 0.2,
  "timeoutMs": 12000,
  "maxAttempts": 1,
  "fallbacks": [
    {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "temperature": 0.2,
      "timeoutMs": 20000,
      "maxAttempts": 1
    }
  ],
  "enabled": true,
  "updatedBy": "admin-user-id",
  "updatedAt": "timestamp"
}
```

To switch models, update `model` or ordered `fallbacks`. Runtime currently supports Gemini primary/candidates and Anthropic fallback/candidates.

### `coachConsultations/{consultationId}`

Stores LINE AI coach/menu recommendation answers separately from food logs.

```json
{
  "consultationId": "auto-id",
  "userId": "canonical-user-id",
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "source": "line",
  "mode": "consultation",
  "question": "กินอะไรดี",
  "answer": "Thai coach answer",
  "summarySnapshot": {
    "consumedCalories": 900,
    "burnedCalories": 100,
    "dynamicTargetCalories": 2100,
    "remainingCalories": 1200
  },
  "targetSnapshot": {
    "calories": 2000,
    "proteinG": 120,
    "carbsG": 200,
    "fatG": 60,
    "fiberG": 25
  },
  "recentMeals": ["meal name (400 kcal)"],
  "ai": {
    "runId": "aiRuns-id",
    "agentId": "coachConsultation",
    "primaryProvider": "gemini",
    "primaryModel": "gemini-3.5-flash",
    "provider": "gemini",
    "model": "gemini-3.5-flash",
    "promptVersion": "coach-v1",
    "fallbackUsed": false
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## Notes

- `profiles` is split from `users` so app auth and health profile can evolve independently.
- `lineLinks` and `authLinks` allow LINE OA and native app to share one data record per user.
- `subscriptions` is write-protected for admins/backend only.
