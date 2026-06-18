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
  "timeoutMs": 20000,
  "maxAttempts": 2,
  "fallbacks": [],
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
  "timeoutMs": 20000,
  "maxAttempts": 2,
  "fallbacks": [],
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
  "timeoutMs": 20000,
  "maxAttempts": 2,
  "fallbacks": [],
  "enabled": true,
  "updatedBy": "admin",
  "updatedAt": "timestamp"
}
```

`aiAgents/coachConsultation`

```json
{
  "agentId": "coachConsultation",
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "promptVersion": "coach-v1",
  "temperature": 0.4,
  "timeoutMs": 20000,
  "maxAttempts": 2,
  "fallbacks": [],
  "enabled": true,
  "updatedBy": "admin",
  "updatedAt": "timestamp"
}
```

Seed or update this config without touching user data:

```bash
node tools/seed_ai_agents.js --project mydietitian --commit
```

Configure Claude fallback after `ANTHROPIC_API_KEY` is available:

```bash
node tools/configure_ai_provider_fallbacks.js --project mydietitian --anthropicModel <anthropic-model-id>
```

The fallback tool is dry-run by default. Add `--commit` only after reviewing the printed diff:

```bash
node tools/configure_ai_provider_fallbacks.js --project mydietitian --anthropicModel <anthropic-model-id> --commit
```

## Default fallback

If an `aiAgents/{agentId}` document does not exist, the backend falls back to:

```json
{
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "promptVersion": "agent-specific-v1",
  "temperature": 0.2,
  "timeoutMs": 20000,
  "maxAttempts": 2,
  "fallbacks": [],
  "enabled": true
}
```

## Reliability controls

Every Gemini call now has bounded retries and timeout controls:

```json
{
  "timeoutMs": 20000,
  "maxAttempts": 2,
  "fallbacks": [
    {
      "provider": "anthropic",
      "model": "<anthropic-model-id>",
      "temperature": 0.2,
      "timeoutMs": 20000,
      "maxAttempts": 1
    }
  ]
}
```

Behavior:

- `maxAttempts` retries the same model for transient failures only: timeout, `408`, `429`, and `5xx`.
- `fallbacks` are tried in order only after the primary candidate fails.
- Current runtime fallback supports Gemini and Anthropic/Claude candidates. `openai` is accepted in config for future admin compatibility, but its provider adapter must be implemented before it can answer.
- `maxAttempts` is capped at `4` to avoid LINE timeout cascades and runaway API spend.

Recommended production pattern:

```json
{
  "provider": "gemini",
  "model": "gemini-3-flash-preview",
  "timeoutMs": 12000,
  "maxAttempts": 1,
  "fallbacks": [
    {
      "provider": "anthropic",
      "model": "<fast-anthropic-model-id>",
      "temperature": 0.2,
      "timeoutMs": 18000,
      "maxAttempts": 1
    },
    {
      "provider": "anthropic",
      "model": "<strong-anthropic-model-id>",
      "temperature": 0.2,
      "timeoutMs": 22000,
      "maxAttempts": 1
    }
  ]
}
```

This intentionally avoids retrying Gemini several times during provider overload. It fails fast to Claude so LINE users get an answer before the webhook interaction feels broken.

Before production deploy, confirm the exact Anthropic model IDs in the Anthropic Console/API docs for the account. Do not seed a Claude fallback until `ANTHROPIC_API_KEY` is configured and a canary call has passed.

## Changing model

Update only the `model` field, for example:

```json
{
  "model": "future-gemini-model"
}
```

The backend records the model used on AI-created records such as `aiRuns`, `mealLogs.ai`, `exerciseLogs.ai`, `coachConsultations.ai`, and `biaReports.analysis`.

## Changing provider

Provider switching is enabled for `gemini` and `anthropic`.

To use Claude/Anthropic:

1. Add `ANTHROPIC_API_KEY` to Secret Manager.
2. Set an Anthropic fallback in the target `aiAgents/{agentId}` document.
3. Keep Gemini as primary or set the target agent provider directly to `anthropic`.
4. Run canary tests before switching all users.

To add OpenAI later, follow the same adapter pattern with an `OPENAI_API_KEY` secret and keep the exact same response contracts.

## Secret safety

Never use `firebase functions:secrets:access` during normal checks because it prints the secret value to the terminal. Use `describe` instead:

```bash
firebase functions:secrets:describe GEMINI_API_KEY --project mydietitian
firebase functions:secrets:describe ANTHROPIC_API_KEY --project mydietitian
```

If a key is accidentally printed in logs, rotate that provider key and update the matching Secret Manager value before production deployment.

## Admin UI plan

The admin dashboard should expose:

- Agent enabled/disabled toggle.
- Provider select.
- Model input/select.
- Prompt version.
- Temperature.
- Timeout and max attempts.
- Ordered fallback candidates.
- Last updated by/date.
- Test prompt button.
- Canary percentage when provider abstraction is complete.
- Provider/model latency and failure history.
