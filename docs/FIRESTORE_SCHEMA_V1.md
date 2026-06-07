# Firestore Schema V1

This is the first-pass schema for migrating the current GAS + Google Sheets system into Firebase.

## Collections

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
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

### `mealLogs/{mealLogId}`

Food analysis records created from text or image input.

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
    "provider": "gemini",
    "model": "gemini-3-flash-preview",
    "promptVersion": "meal-v1"
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

### `biaReports/{biaReportId}`

BIA/InBody/smart-scale/health report queue created from LINE image or file uploads.

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
  "expiresAt": "timestamp",
  "lastApprovedDays": 30,
  "lastApprovedBy": "admin-line-user-id",
  "lastApprovedAt": "timestamp",
  "lastRedeemedCode": "ABC123",
  "updatedAt": "timestamp"
}
```

### `profileEvents/{eventId}`

Append-only profile setup/update events, including LINE quick setup during staging.

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

### `subscriptionRequests/{requestId}`

Staging record created when a LINE user asks for `สมัคร` / `เติมวัน`.

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

```json
{
  "type": "admin-approve",
  "canonicalUserId": "canonical-user-id",
  "lineUserId": "Uxxxxxxxx",
  "days": 30,
  "expiresAt": "timestamp",
  "createdAt": "timestamp"
}
```

### `redeemCodes/{code}`

Migrated subscription codes from the legacy `Codes` sheet.

```json
{
  "code": "ABC123",
  "days": 30,
  "status": "available",
  "usedBy": null,
  "usedDate": null
}
```

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
  "model": "gemini-3-flash-preview",
  "promptVersion": "meal-v1",
  "temperature": 0.2,
  "enabled": true,
  "updatedBy": "admin-user-id",
  "updatedAt": "timestamp"
}
```

To switch models, update `model`. To switch providers later, create the new provider implementation and set `provider` to the supported provider name.

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
    "provider": "gemini",
    "model": "gemini-3-flash-preview",
    "promptVersion": "coach-v1"
  },
  "createdAt": "timestamp",
  "updatedAt": "timestamp"
}
```

## Notes

- `profiles` is split from `users` so app auth and health profile can evolve independently.
- `lineLinks` and `authLinks` allow LINE OA and native app to share one data record per user.
- `subscriptions` is write-protected for admins/backend only.
