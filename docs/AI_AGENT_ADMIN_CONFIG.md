# AI Agent Admin Config

The backend reads AI agent settings from Firestore before calling the provider. This keeps model/provider changes out of business logic.

## Collection

`aiAgents/{agentId}`

## Current agents

`aiAgents/mealAnalysis`

```json
{
  "agentId": "mealAnalysis",
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "promptVersion": "meal-v1",
  "temperature": 0.2,
  "enabled": true,
  "updatedBy": "admin",
  "updatedAt": "timestamp"
}
```

`aiAgents/exerciseAnalysis`

```json
{
  "agentId": "exerciseAnalysis",
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "promptVersion": "exercise-v1",
  "temperature": 0.2,
  "enabled": true,
  "updatedBy": "admin",
  "updatedAt": "timestamp"
}
```

`aiAgents/biaAnalysis`

```json
{
  "agentId": "biaAnalysis",
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "promptVersion": "bia-v1",
  "temperature": 0.1,
  "enabled": true,
  "updatedBy": "admin",
  "updatedAt": "timestamp"
}
```

Seed or update this config without touching user data:

```bash
node tools/seed_ai_agents.js --project mydietitian --commit
```

## Default fallback

If an `aiAgents/{agentId}` document does not exist, the backend falls back to:

```json
{
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "promptVersion": "agent-specific-v1",
  "temperature": 0.2,
  "enabled": true
}
```

## Changing model

Update only the `model` field, for example:

```json
{
  "model": "future-gemini-model"
}
```

The backend records the model used on AI-created records such as `aiRuns`, `mealLogs.ai`, `exerciseLogs.ai`, and `biaReports.analysis`.

## Changing provider

Provider switching is designed but not fully enabled yet. The backend currently supports `gemini` only. To add Claude/Anthropic later:

1. Add `ANTHROPIC_API_KEY` to Secret Manager.
2. Add an Anthropic provider implementation.
3. Keep returning the same `MealAnalysisResult` shape.
4. Set the target agent provider, for example `aiAgents/mealAnalysis.provider` or `aiAgents/biaAnalysis.provider`, to `anthropic`.
5. Run canary tests before switching all users.

## Admin UI plan

The admin dashboard should expose:

- Agent enabled/disabled toggle.
- Provider select.
- Model input/select.
- Prompt version.
- Temperature.
- Last updated by/date.
- Test prompt button.
- Canary percentage when provider abstraction is complete.
