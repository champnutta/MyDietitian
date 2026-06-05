# Firestore Schema V1

This is the first-pass schema for migrating the current GAS + Google Sheets system into Firebase.

## Collections

### `users/{userId}`

Top-level account document for auth-linked app users.

```json
{
  "userId": "firebase-auth-uid",
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

### `profiles/{userId}`

Health and target profile used by the AI coach.

```json
{
  "userId": "firebase-auth-uid",
  "displayName": "Champ",
  "lineUserId": "Uxxxxxxxx",
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
    "model": "gemini-2.5-flash",
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
  "weightKg": 72.4,
  "bodyFatPct": 19.3,
  "muscleMassKg": 31.2,
  "deviceName": "Smart Scale",
  "loggedAt": "timestamp",
  "createdAt": "timestamp"
}
```

### `subscriptions/{userId}`

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
  "appUserId": "firebase-auth-uid",
  "linkedAt": "timestamp",
  "status": "linked"
}
```

## Notes

- `profiles` is split from `users` so app auth and health profile can evolve independently.
- `lineLinks` is temporary but useful while LINE OA and app run in parallel.
- `subscriptions` is write-protected for admins/backend only.
