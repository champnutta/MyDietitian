# Next Actions Before Data Migration

Current safe state:

- Firebase Functions are deployed.
- Gemini and Anthropic secrets are configured in project `mydietitian`.
- AI agents use `gemini-3.5-flash` primary with `claude-sonnet-4-6` fallback.
- Production LINE webhook remains on GAS.
- Google Sheet remains the source of truth until final migration.

## Required manual gates

1. Complete real LINE media UAT using `docs/MANUAL_UAT_EVIDENCE_TEMPLATE.md`.
2. Complete real LIFF auth UAT using a real LINE LIFF session.
3. Review rollback values and record the current GAS webhook URL.
4. Explicitly approve the final migration window only after UAT evidence passes.

## Commands to run before approval

Prepare a local evidence working copy. This file is ignored by Git because it can contain LINE IDs and customer evidence:

```powershell
$env:LINE_CHANNEL_SECRET="<staging-or-production-line-channel-secret>"
npm run uat:prepare-evidence -- --project mydietitian --force
```

```powershell
npm run report:pre-cutover -- --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --smoke-write
node tools/check_ai_fallback_readiness.js --project mydietitian
node tools/check_ai_agent_runtime_config.js --project mydietitian --serviceAccount "C:\Users\champ\AppData\Roaming\firebase\znak_iiz_gmail.com_application_default_credentials.json" --require-anthropic-fallback
npm run uat:evidence-check -- --file docs/MANUAL_UAT_EVIDENCE.md --phase pre-migration
npm run uat:remaining -- --file docs/MANUAL_UAT_EVIDENCE.md --phase pre-migration
```

Do not run final data migration or switch production LINE webhook until every manual gate is recorded as `pass`.
