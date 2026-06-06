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

### `subscriptions/{canonicalUserId}`

Subscription and entitlement record managed by backend/admin flow.

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

## Notes

- `profiles` is split from `users` so app auth and health profile can evolve independently.
- `lineLinks` and `authLinks` allow LINE OA and native app to share one data record per user.
- `subscriptions` is write-protected for admins/backend only.
