# LIFF Settings Replacement

Firebase Hosting now serves the replacement settings form:

- Hosting page: `https://mydietitian.web.app/settings`
- Firebase endpoint: `https://asia-southeast1-mydietitian.cloudfunctions.net/saveSettingsFromWeb`
- Current LIFF ID: `2009365288-Ux31tFWT`
- Current LINE channel ID fallback: `2009365288`

## What This Replaces

The old GAS `Form.html` used `google.script.run.saveSettingsFromWeb(...)`.
The new hosted form calls Firebase `saveSettingsFromWeb` directly and sends `X-Line-Id-Token` when LIFF provides a LINE ID token.

The backend still allows no-token staging saves while `PROFILE_AUTH_MODE=optional`, but verified LIFF saves should show `authVerified: true`.

## LINE Console Setup

Before switching users to the new form, update the LIFF app endpoint URL in LINE Developers Console:

```text
https://mydietitian.web.app/settings
```

Keep the LIFF URL itself in Flex messages as:

```text
https://liff.line.me/2009365288-Ux31tFWT?page=form&uid={LINE_USER_ID}
```

`appConfig/runtime.liffSettingsUrl` currently stores the LIFF URL, not the hosted endpoint. The LIFF URL opens the endpoint configured in LINE Console.

## Verification

1. Open the LIFF URL from a staging LINE chat.
2. Confirm the page says it is connected to LINE.
3. Save auto settings and custom settings.
4. Check `profiles/{canonicalUserId}` and `profileAuthEvents` in Firestore.
5. Confirm `authVerified: true` before changing `PROFILE_AUTH_MODE=required`.

## Production Guardrail

Do not switch production LINE OA away from GAS just because this LIFF form works. The final order remains:

1. Finish staging LINE media/file/payment tests.
2. Verify dashboard replacement against migrated preview data.
3. Run final Google Sheet migration window.
4. Switch production LINE webhook with rollback ready.
